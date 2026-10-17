"use client";
import { useAutosave, SaveStatus } from "@/components/autosave";
import { ChipInput } from "@/components/chip-input";
import { saveVoice } from "../actions";
import { examples, type Voice as VoiceType } from "@/lib/setup";
export function Voice({
  workspace,
  initial,
}: {
  workspace: string;
  initial: VoiceType;
}) {
  const a = useAutosave(
      initial,
      initial.setup_revision,
      "signals:" + workspace + ":voice",
      (v, r) => saveVoice(workspace, v, r),
    ),
    v = a.value;
  return (
    <section className="section setup-step">
      <div className="section-heading">
        <h2>Voice and copy</h2>
        <SaveStatus {...a} />
      </div>
      <fieldset>
        <legend>Write openers for</legend>
        <div className="chips">
          {[
            ["email", "Email"],
            ["linkedin", "LinkedIn"],
          ].map(([key, label]) => (
            <button
              type="button"
              className="chip"
              aria-pressed={v.channels.includes(key)}
              key={key}
              onClick={() =>
                a.edit({
                  ...v,
                  channels: v.channels.includes(key)
                    ? v.channels.filter((c) => c !== key)
                    : [...v.channels, key],
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="field-grid">
        <label>
          Sign-off
          <input
            maxLength={200}
            value={v.sign_off}
            onChange={(e) => a.edit({ ...v, sign_off: e.target.value })}
          />
        </label>
        <label>
          LinkedIn length
          <select
            aria-label="LinkedIn length"
            value={v.linkedin_length}
            onChange={(e) =>
              a.edit({ ...v, linkedin_length: Number(e.target.value) })
            }
          >
            <option value={280}>280 characters</option>
            <option value={200}>200 characters</option>
          </select>
        </label>
      </div>
      <label>
        Real example messages
        <textarea
          rows={12}
          value={v.examples_text}
          maxLength={40000}
          onChange={(e) => a.edit({ ...v, examples_text: e.target.value })}
        />
        <span className="small-note">
          These teach tone, length and phrasing. Nothing is copied or picked
          from this list: every opener is written fresh from its signal, in this
          style.
        </span>
        <span className="small-note">
          Add 3 to 10 complete examples, separated by a line containing ---.{" "}
          {examples(v.examples_text).length} examples entered.
        </span>
      </label>
      <label>
        Tone
        <span className="small-note">
          A few words describing how the client sounds.
        </span>
        <input
          value={v.tone}
          maxLength={1000}
          onChange={(e) => a.edit({ ...v, tone: e.target.value })}
        />
      </label>
      <ChipInput
        label="Never say"
        values={v.banned_phrases}
        onChange={(banned_phrases) => a.edit({ ...v, banned_phrases })}
      />
    </section>
  );
}
