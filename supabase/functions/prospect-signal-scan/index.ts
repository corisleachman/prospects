import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://corisleachman.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ACTOR_ID = "harvestapi~linkedin-profile-posts";
const POST_PRICE_USD = 0.002;
const SEARCH_ACTOR_ID = "harvestapi~linkedin-post-search";
const SEARCH_ITEM_PRICE_USD = 0.002;
const SEARCH_ZERO_RESULT_PRICE_USD = 0.001;

type Contact = { id: string; name: string; company: string | null; linkedin_url: string | null; signal_scanned_at: string | null };
type Classification = {
  polarity: "opportunity" | "pressure" | "intent" | "perspective" | null;
  category: string | null;
  trigger: number;
  need: number;
  readiness: number;
  fit: number;
  hypothesis: string | null;
  action: "ignore" | "monitor" | "research" | "comment" | "connect" | "message" | "email";
  angle: string | null;
};

const categories = [
  { key: "explicit_frustration", polarity: "pressure", rx: /struggl|frustrat|difficult|hard to|challenge|overwhelm|stuck|pain point|not working|inconsistent/i, need: 3, readiness: 1, hypothesis: "The post may reveal an explicit pressure or frustration worth understanding before offering help." },
  { key: "system_pressure", polarity: "pressure", rx: /capacity|bandwidth|too busy|time poor|wearing.*hats|manual|spreadsheet|disconnected|workflow|process|system|operational/i, need: 3, readiness: 1, hypothesis: "Growth activity may be creating process or capacity pressure that needs a more repeatable system." },
  { key: "pipeline_quality", polarity: "pressure", rx: /pipeline|new business|business development|referral|lead gen|lead generation|forecast|conversion|outbound|prospect/i, need: 3, readiness: 1, hypothesis: "The agency may be reviewing how it creates, qualifies or manages new-business opportunities." },
  { key: "team_expansion", polarity: "intent", rx: /we.re hiring|hiring|join our team|new hire|appointed|welcome.*team|head of growth|business development director|marketing director/i, need: 2, readiness: 2, hypothesis: "The agency is investing in capacity, which may create a timely need to clarify ownership, process and supporting systems." },
  { key: "offer_development", polarity: "intent", rx: /new service|new offer|new capability|launching|we.ve launched|proposition|productised|practice|division/i, need: 2, readiness: 2, hypothesis: "A new offer may need clearer packaging, proof and a deliberate route to market." },
  { key: "positioning_change", polarity: "intent", rx: /rebrand|new website|new identity|positioning|brand refresh|new chapter|evolv.*brand|specialis/i, need: 2, readiness: 2, hypothesis: "A positioning change may be a useful moment to check whether the commercial story is landing clearly with buyers." },
  { key: "growth_ambition", polarity: "opportunity", rx: /growth|expan|new market|new office|ambition|scale|momentum|next phase|acquisition/i, need: 2, readiness: 2, hypothesis: "Visible growth ambition may create a need for the commercial operating system to keep pace." },
  { key: "commercial_momentum", polarity: "opportunity", rx: /client win|new client|appointed by|delighted to.*win|award|shortlist|record year|milestone/i, need: 1, readiness: 2, hypothesis: "Commercial momentum may create an opportunity to make success more repeatable rather than treating one announcement as proof of a problem." },
  { key: "ai_enabled_growth", polarity: "perspective", rx: /\bAI\b|artificial intelligence|automation|agentic|generative|ChatGPT|Claude/i, need: 2, readiness: 1, hypothesis: "The prospect is publicly engaging with AI, which may support a practical conversation about useful workflows and adoption." },
  { key: "founder_perspective", polarity: "perspective", rx: /I think|I.ve been thinking|my view|we believe|lesson|what I.ve learned|question for/i, need: 1, readiness: 1, hypothesis: "The post expresses a personal perspective that may be better engaged with publicly before any private outreach." },
] as const;

function linkedinSlug(value: string | null | undefined) {
  const match = String(value || "").toLowerCase().match(/linkedin\.com\/in\/([^/?#]+)/);
  return match ? match[1].replace(/\/+$/, "") : "";
}

function classify(text: string, observedAt: string | null): Classification {
  const clean = String(text || "").trim();
  const match = categories.find((item) => item.rx.test(clean));
  if (!match) return { polarity: null, category: null, trigger: 1, need: 0, readiness: 0, fit: 1, hypothesis: null, action: "ignore", angle: null };
  const ageDays = observedAt ? Math.max(0, (Date.now() - new Date(observedAt).getTime()) / 86400000) : 999;
  const trigger = ageDays <= 30 ? 3 : ageDays <= 90 ? 2 : 1;
  const fit = /(agency|studio|creative|digital|social|brand|marketing|client|commercial|growth|new business|pipeline|AI|automation)/i.test(clean) ? 2 : 1;
  const total = trigger + match.need + match.readiness + fit;
  const action = total >= 9 ? "message" : total >= 7 ? (match.polarity === "perspective" ? "comment" : "research") : total >= 4 ? "monitor" : "ignore";
  const angle = total >= 7 ? (match.polarity === "opportunity"
    ? "Acknowledge the positive event, then ask what needs to change commercially to sustain the momentum."
    : match.polarity === "pressure"
    ? "Treat the implication as a hypothesis. Ask one diagnostic question and avoid claiming to know the problem."
    : match.polarity === "intent"
    ? "Connect the visible investment to one practical question about readiness, ownership or route to market."
    : "Respond to the person's stated view first. Keep any private follow-up low-pressure and useful.") : null;
  return { polarity: match.polarity, category: match.key, trigger, need: match.need, readiness: match.readiness, fit, hypothesis: match.hypothesis, action, angle };
}


function cleanLinkedInProfile(value: string | null | undefined) {
  const raw = String(value || "");
  const profile = raw.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (profile) return "https://www.linkedin.com/in/" + profile[1].replace(/\/+$/, "");
  const sales = raw.match(/linkedin\.com\/sales\/lead\/([^,/?#]+)/i);
  if (sales) return "https://www.linkedin.com/sales/lead/" + sales[1];
  return "";
}

function cleanSourceUrl(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

function discoveryScore(text: string, parentText: string, authorInfo: string, observedAt: string | null) {
  const combined = (text + " " + parentText).toLowerCase();
  const subject = /(new business|business development|lead gen|lead generation|pipeline|referral|outbound|prospect|agency growth)/i.test(combined) ? 3
    : /(growth|marketing|positioning|crm|workflow|automation|artificial intelligence|\bai\b)/i.test(combined) ? 2 : 0;
  const ageDays = observedAt ? Math.max(0, (Date.now() - new Date(observedAt).getTime()) / 86400000) : 999;
  const recency = ageDays <= 7 ? 2 : ageDays <= 30 ? 1 : 0;
  const contribution = /\?|I think|I.ve found|my view|challenge|struggl|frustrat|lesson|agree|disagree/i.test(text) ? 2 : text.length >= 80 ? 1 : 0;
  const senior = /(founder|co-founder|owner|managing director|\bmd\b|chief|ceo|growth director|head of growth|new business director|business development director)/i.test(authorInfo);
  const relevant = senior || /(agency|creative|digital|social|brand|marketing|new business|business development|growth)/i.test(authorInfo);
  const audience = senior ? 2 : relevant ? 1 : 0;
  const relationship = senior ? 1 : 0;
  return { subject, recency, contribution, audience, relationship, total: subject + recency + contribution + audience + relationship };
}

function discoveryDraft(sourceType: string, category: string | null) {
  if (sourceType === "linkedin_comment") return "I agree with your point about [specific point]. The part agencies often underestimate is [useful observation]. Have you found [short genuine question]?";
  if (category === "team_expansion") return "Saw you’re hiring for [role]. It looks like you’re putting real focus behind growth at the moment. I’ve spent 20 years working across agency new business, so thought it would be good to connect.";
  if (category === "commercial_momentum") return "Really nice to see [specific win or recognition]. It looks like there’s a lot happening for the team. I work across agency growth and new business, so thought I’d say hello and connect.";
  if (category === "offer_development" || category === "positioning_change") return "Saw what you’re doing around [specific change]. The bit about [detail] stood out. I work with agencies on positioning and routes to market, so thought it would be good to connect.";
  return "Your point about [specific point] caught my attention, particularly [detail]. I’ve worked across agency growth and new business for 20 years, so thought it would be good to connect.";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);

    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY") || "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const apifyToken = Deno.env.get("APIFY_TOKEN");
    const body = await req.json().catch(() => ({}));
    const action = body.action || "status";

    if (action === "status") {
      return json({ configured: Boolean(apifyToken), actorId: ACTOR_ID, postPriceUsd: POST_PRICE_USD, maxBatchSize: 30, maxPostsPerContact: 5 });
    }


    if (action === "estimate_discovery" || action === "run_discovery") {
      const queries = Array.isArray(body.search_queries)
        ? [...new Set(body.search_queries.map((value: unknown) => String(value).trim()).filter(Boolean))]
        : [];
      if (!queries.length || queries.length > 6 || queries.some((query) => query.length > 500)) {
        return json({ error: "Choose between 1 and 6 search queries, each under 500 characters." }, 400);
      }
      const maxPosts = Math.min(20, Math.max(3, Number(body.max_posts_per_query || 8)));
      const postedLimit = ["24h", "week", "month"].includes(body.posted_limit) ? body.posted_limit : "week";
      const includeComments = body.include_comments === true;
      const maxComments = includeComments ? Math.min(5, Math.max(1, Number(body.max_comments_per_post || 3))) : 0;
      const maximumItems = queries.length * maxPosts * (1 + maxComments);
      const estimatedMaxCostUsd = maximumItems * SEARCH_ITEM_PRICE_USD + queries.length * SEARCH_ZERO_RESULT_PRICE_USD;
      const recommendedCapUsd = Math.max(0.02, Math.ceil((estimatedMaxCostUsd + 0.01) * 100) / 100);

      if (action === "estimate_discovery") {
        return json({
          queries: queries.length,
          maxPostsPerQuery: maxPosts,
          includeComments,
          maxCommentsPerPost: maxComments,
          maximumItems,
          estimatedMaxCostUsd,
          recommendedCapUsd,
          pricing: { itemUsd: SEARCH_ITEM_PRICE_USD, zeroResultQueryUsd: SEARCH_ZERO_RESULT_PRICE_USD },
        });
      }
      if (!apifyToken) return json({ error: "APIFY_TOKEN is not configured." }, 503);
      if (body.confirm_paid_run !== true) return json({ error: "Paid run not confirmed.", estimate: { maximumItems, estimatedMaxCostUsd, recommendedCapUsd } }, 402);

      const { data: runRow, error: runInsertError } = await supabase
        .from("prospect_signal_runs")
        .insert({
          user_id: authData.user.id,
          status: "running",
          actor_id: SEARCH_ACTOR_ID.replace("~", "/"),
          contact_count: 0,
          requested_posts_per_contact: maxPosts,
          estimated_max_cost_usd: recommendedCapUsd,
        })
        .select("id")
        .single();
      if (runInsertError) throw runInsertError;

      const actorInput = {
        searchQueries: queries,
        postedLimit,
        sortBy: "date",
        maxPosts,
        scrapeReactions: false,
        scrapeComments: includeComments,
        maxComments,
      };
      const endpoint = new URL("https://api.apify.com/v2/acts/" + SEARCH_ACTOR_ID + "/run-sync-get-dataset-items");
      endpoint.searchParams.set("maxTotalChargeUsd", recommendedCapUsd.toFixed(2));
      endpoint.searchParams.set("clean", "true");
      endpoint.searchParams.set("format", "json");

      const actorResponse = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + apifyToken, "Content-Type": "application/json" },
        body: JSON.stringify(actorInput),
        signal: AbortSignal.timeout(120000),
      });
      const responseText = await actorResponse.text();
      if (!actorResponse.ok) {
        await supabase.from("prospect_signal_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: responseText.slice(0, 1000) }).eq("id", runRow.id);
        return json({ error: "Apify discovery run failed.", detail: responseText.slice(0, 500) }, 502);
      }

      const items = JSON.parse(responseText);
      const { data: knownContacts, error: knownError } = await supabase.from("contacts").select("id,linkedin_url").not("linkedin_url", "is", null);
      if (knownError) throw knownError;
      const knownProfiles = new Set((knownContacts || []).map((contact) => cleanLinkedInProfile(contact.linkedin_url)).filter(Boolean).map((url) => url.toLowerCase()));
      const found = new Map<string, Record<string, unknown>>();

      for (const item of Array.isArray(items) ? items : []) {
        if (item?.type !== "post" || !item?.linkedinUrl || !item?.content) continue;
        const observedAt = item?.postedAt?.date || (item?.postedAt?.timestamp ? new Date(item.postedAt.timestamp).toISOString() : null);
        const query = String(item?.searchQuery || item?.query || "");
        const postUrl = cleanSourceUrl(item.linkedinUrl);
        const candidates = [{
          sourceType: "linkedin_post",
          sourceUrl: postUrl,
          sourceText: String(item.content || ""),
          parentText: "",
          observedAt,
          author: item.author,
          raw: item,
        }];
        if (includeComments && Array.isArray(item.comments)) {
          for (const comment of item.comments.slice(0, maxComments)) {
            candidates.push({
              sourceType: "linkedin_comment",
              sourceUrl: String(comment.linkedinUrl || postUrl),
              sourceText: String(comment.commentary || ""),
              parentText: String(item.content || ""),
              observedAt: comment.createdAt || observedAt,
              author: comment.actor,
              raw: { comment, parentPost: { id: item.id, linkedinUrl: item.linkedinUrl, content: item.content } },
            });
          }
        }

        for (const candidate of candidates) {
          const profileUrl = cleanLinkedInProfile(candidate.author?.linkedinUrl);
          if (!profileUrl || knownProfiles.has(profileUrl.toLowerCase()) || !candidate.sourceText) continue;
          const authorInfo = String(candidate.author?.info || candidate.author?.position || "");
          const score = discoveryScore(candidate.sourceText, candidate.parentText, authorInfo, candidate.observedAt);
          if (score.subject < 2 || score.audience < 1 || score.total < 5) continue;
          const classified = classify(candidate.sourceText + " " + candidate.parentText, candidate.observedAt);
          const key = profileUrl.toLowerCase() + "|" + candidate.sourceUrl;
          const row = {
            user_id: authData.user.id,
            observed_at: candidate.observedAt,
            linkedin_url: profileUrl,
            name: candidate.author?.name || null,
            company: null,
            title: authorInfo || null,
            source_url: candidate.sourceUrl,
            source_text: candidate.sourceText,
            source_type: candidate.sourceType,
            search_query: query || null,
            author_info: authorInfo || null,
            parent_post_text: candidate.parentText || null,
            signal_category: classified.category,
            signal_polarity: classified.polarity,
            subject_score: score.subject,
            recency_score: score.recency,
            contribution_score: score.contribution,
            audience_score: score.audience,
            relationship_score: score.relationship,
            total_score: score.total,
            working_hypothesis: classified.hypothesis,
            suggested_action: score.total >= 7 ? "comment_or_connect" : "review",
            draft_copy: discoveryDraft(candidate.sourceType, classified.category),
            raw_payload: candidate.raw,
          };
          const previous = found.get(key);
          if (!previous || Number(previous.total_score || 0) < score.total) found.set(key, row);
        }
      }

      const rows = [...found.values()];
      let stored: unknown[] = [];
      if (rows.length) {
        const { data, error } = await supabase
          .from("prospect_discoveries")
          .upsert(rows, { onConflict: "user_id,linkedin_url,source_url" })
          .select("id,name,linkedin_url,source_url,total_score,suggested_action");
        if (error) throw error;
        stored = data || [];
      }
      const completedAt = new Date().toISOString();
      await supabase.from("prospect_signal_runs").update({ status: "succeeded", completed_at: completedAt, actual_item_count: Array.isArray(items) ? items.length : 0 }).eq("id", runRow.id);
      return json({ runId: runRow.id, actorItems: Array.isArray(items) ? items.length : 0, qualifiedDiscoveries: rows.length, storedDiscoveries: stored, completedAt });
    }

    const contactIds = Array.isArray(body.contact_ids) ? [...new Set(body.contact_ids.map(String))] : [];
    const postsPerContact = Math.min(5, Math.max(1, Number(body.posts_per_contact || 3)));
    if (!contactIds.length || contactIds.length > 30) return json({ error: "Choose between 1 and 30 prospects." }, 400);

    const { data: contacts, error: contactsError } = await supabase
      .from("contacts")
      .select("id,name,company,linkedin_url,signal_scanned_at")
      .in("id", contactIds);
    if (contactsError) throw contactsError;

    const withLinkedIn = (contacts as Contact[] || []).filter((c) => linkedinSlug(c.linkedin_url));
    const forceRescan = body.force_rescan === true;
    const alreadyScanned = withLinkedIn.filter((c) => c.signal_scanned_at).map((c) => ({ id: c.id, name: c.name, scannedAt: c.signal_scanned_at }));
    const valid = forceRescan ? withLinkedIn : withLinkedIn.filter((c) => !c.signal_scanned_at);
    const missing = (contacts as Contact[] || []).filter((c) => !linkedinSlug(c.linkedin_url)).map((c) => ({ id: c.id, name: c.name }));
    const estimatedPostCost = valid.length * postsPerContact * POST_PRICE_USD;
    const recommendedCapUsd = Math.max(0.02, Math.ceil((estimatedPostCost + valid.length * 0.001 + 0.01) * 100) / 100);

    if (action === "estimate") {
      return json({ selected: contactIds.length, eligible: valid.length, missingLinkedIn: missing, alreadyScanned, forceRescan, postsPerContact, estimatedPostCostUsd: estimatedPostCost, recommendedCapUsd });
    }
    if (action !== "run") return json({ error: "Unknown action" }, 400);
    if (!apifyToken) return json({ error: "APIFY_TOKEN is not configured." }, 503);
    if (body.confirm_paid_run !== true) return json({ error: "Paid run not confirmed.", estimate: { eligible: valid.length, postsPerContact, estimatedPostCostUsd: estimatedPostCost, recommendedCapUsd } }, 402);
    if (!valid.length) return json({ error: "None of the selected prospects has a usable LinkedIn profile URL." }, 400);

    const { data: runRow, error: runInsertError } = await supabase
      .from("prospect_signal_runs")
      .insert({
        user_id: authData.user.id,
        status: "running",
        actor_id: ACTOR_ID.replace("~", "/"),
        contact_count: valid.length,
        requested_posts_per_contact: postsPerContact,
        estimated_max_cost_usd: recommendedCapUsd,
      })
      .select("id")
      .single();
    if (runInsertError) throw runInsertError;

    const actorInput = {
      targetUrls: valid.map((c) => c.linkedin_url),
      maxPosts: postsPerContact,
      scrapeReactions: false,
      scrapeComments: false,
      includeQuotePosts: true,
      includeReposts: false,
    };
    const endpoint = new URL("https://api.apify.com/v2/acts/" + ACTOR_ID + "/run-sync-get-dataset-items");
    endpoint.searchParams.set("maxTotalChargeUsd", recommendedCapUsd.toFixed(2));
    endpoint.searchParams.set("clean", "true");
    endpoint.searchParams.set("format", "json");

    const actorResponse = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + apifyToken, "Content-Type": "application/json" },
      body: JSON.stringify(actorInput),
      signal: AbortSignal.timeout(120000),
    });
    const responseText = await actorResponse.text();
    if (!actorResponse.ok) {
      await supabase.from("prospect_signal_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: responseText.slice(0, 1000) }).eq("id", runRow.id);
      return json({ error: "Apify run failed.", detail: responseText.slice(0, 500) }, 502);
    }

    const items = JSON.parse(responseText);
    const contactBySlug = new Map(valid.map((c) => [linkedinSlug(c.linkedin_url), c]));
    const rows = (Array.isArray(items) ? items : []).filter((item) => item?.type === "post" && item?.linkedinUrl && item?.content).flatMap((item) => {
      const slug = linkedinSlug(item?.author?.linkedinUrl) || String(item?.author?.publicIdentifier || "").toLowerCase();
      const contact = contactBySlug.get(slug);
      if (!contact) return [];
      const observedAt = item?.postedAt?.date || (item?.postedAt?.timestamp ? new Date(item.postedAt.timestamp).toISOString() : null);
      const c = classify(item.content, observedAt);
      return [{
        user_id: authData.user.id,
        run_id: runRow.id,
        contact_id: contact.id,
        observed_at: observedAt,
        source_type: "linkedin_post",
        source_external_id: String(item.id || ""),
        source_url: item.linkedinUrl,
        source_text: item.content,
        author_name: item?.author?.name || contact.name,
        signal_polarity: c.polarity,
        signal_category: c.category,
        trigger_score: c.trigger,
        need_score: c.need,
        readiness_score: c.readiness,
        fit_score: c.fit,
        working_hypothesis: c.hypothesis,
        suggested_action: c.action,
        outreach_angle: c.angle,
        raw_payload: item,
      }];
    });

    let stored: unknown[] = [];
    if (rows.length) {
      const { data, error } = await supabase.from("prospect_signals").upsert(rows, { onConflict: "user_id,source_url" }).select("id,contact_id,total_score,signal_category,suggested_action,source_url");
      if (error) throw error;
      stored = data || [];
    }
    const completedAt = new Date().toISOString();
    const { error: contactMarkError } = await supabase
      .from("contacts")
      .update({ signal_scanned_at: completedAt, signal_scan_run_id: runRow.id })
      .in("id", valid.map((contact) => contact.id));
    if (contactMarkError) throw contactMarkError;
    await supabase.from("prospect_signal_runs").update({ status: "succeeded", completed_at: completedAt, actual_item_count: rows.length }).eq("id", runRow.id);

    return json({ runId: runRow.id, selected: contactIds.length, eligible: valid.length, missingLinkedIn: missing, alreadyScanned, actorItems: Array.isArray(items) ? items.length : 0, storedSignals: stored, scannedContactIds: valid.map((contact) => contact.id), scannedAt: completedAt });
  } catch (error) {
    console.error("prospect-signal-scan", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
