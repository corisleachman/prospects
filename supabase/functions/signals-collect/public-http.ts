import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";
export function publicSourceURL(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Use a public HTTPS website or feed.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !u.hostname.includes(".") ||
    /^(localhost|.*\.(localhost|local|internal))$/i.test(u.hostname) ||
    isIP(u.hostname.replace(/[\[\]]/g, ""))
  )
    throw new Error("Use a public HTTPS website or feed, not a local address.");
  u.hash = "";
  return u.href;
}
export function publicAddress(ip: string) {
  if (ip.includes(":")) {
    const first = parseInt(ip.split(":")[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff && !/^2001:0?db8:/i.test(ip);
  }
  const n = ip.split(".").map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return false;
  return !(
    n[0] === 0 ||
    n[0] === 10 ||
    n[0] === 127 ||
    n[0] >= 224 ||
    (n[0] === 169 && n[1] === 254) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && (n[1] === 168 || n[1] === 0)) ||
    (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
    (n[0] === 198 && (n[1] === 18 || n[1] === 19))
  );
}

type Socket={read(v:Uint8Array):Promise<number|null>;write(v:Uint8Array):Promise<number>;close():void};
type NetworkRuntime={connect(v:{hostname:string;port:number}):Promise<Socket>;startTls(s:Socket,v:{hostname:string;alpnProtocols:string[]}):Promise<Socket>};
export function decodeHTTP(bytes:Uint8Array){
 const marker=[13,10,13,10];let end=-1;for(let i=0;i<Math.min(bytes.length-3,65536);i++)if(marker.every((v,k)=>bytes[i+k]===v)){end=i;break;}if(end<0)throw Error("Invalid source response headers");
 const head=new TextDecoder().decode(bytes.slice(0,end)),lines=head.split('\r\n'),status=Number(lines.shift()?.match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);if(!status)throw Error("Invalid source response status");const headers=new Headers();for(const line of lines){const i=line.indexOf(':');if(i>0)headers.append(line.slice(0,i),line.slice(i+1).trim());}
 let body=bytes.slice(end+4);if(/chunked/i.test(headers.get('transfer-encoding')??'')){const chunks:Uint8Array[]=[];let offset=0,total=0;while(offset<body.length){let nl=-1;for(let i=offset;i<body.length-1;i++)if(body[i]===13&&body[i+1]===10){nl=i;break;}if(nl<0)throw Error("Incomplete source chunk");const sizeText=new TextDecoder().decode(body.slice(offset,nl)).split(';')[0];if(!/^[a-f0-9]+$/i.test(sizeText))throw Error("Invalid source chunk");const size=parseInt(sizeText,16);if(size===0)break;if(size>512000||nl+2+size+2>body.length)throw Error("Incomplete or excessive source chunk");chunks.push(body.slice(nl+2,nl+2+size));total+=size;if(total>512000)throw Error("Source page too large");offset=nl+2+size+2;}
 const all=new Uint8Array(total);let pos=0;for(const b of chunks){all.set(b,pos);pos+=b.length;}body=all;
 }else if(headers.has('content-length')&&body.length<Number(headers.get('content-length')))throw Error("Incomplete source response");
 if(body.length>512000)throw Error("Source page too large");return{status,headers,body};
}
async function pinnedRequest(u:URL,address:string){
 const runtime=(globalThis as unknown as {Deno:NetworkRuntime}).Deno;if(!runtime?.startTls)throw Error("Pinned public transport unavailable");
 let conn:Socket|null=null,expired=false,timer:ReturnType<typeof setTimeout>;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;try{conn?.close();}catch{}reject(Error("Source check timed out"));},10000);});
 try{return await Promise.race([timeout,(async()=>{
  conn=await runtime.connect({hostname:address,port:443});if(expired){conn.close();throw Error("Source check timed out");}
  conn=await runtime.startTls(conn,{hostname:u.hostname,alpnProtocols:['http/1.1']});if(expired){conn.close();throw Error("Source check timed out");}
  const request=new TextEncoder().encode('GET '+u.pathname+u.search+' HTTP/1.1\r\nHost: '+u.host+'\r\nUser-Agent: ProspectSignals/2.0\r\nAccept: application/rss+xml,application/atom+xml,text/html,text/plain;q=0.9\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n');let sent=0;while(sent<request.length)sent+=await conn.write(request.subarray(sent));
  const chunks:Uint8Array[]=[];let size=0;while(true){const buffer=new Uint8Array(16384),n=await conn.read(buffer);if(n===null)break;size+=n;if(size>600000)throw Error("Source page too large");chunks.push(buffer.slice(0,n));}
  const data=new Uint8Array(size);let pos=0;for(const c of chunks){data.set(c,pos);pos+=c.length;}return decodeHTTP(data);
 })()]);}finally{clearTimeout(timer!);try{(conn as Socket|null)?.close();}catch{}}
}
export async function getPublicSource(raw:string,redirects=0):Promise<{text:string;url:string}>{
 const url=publicSourceURL(raw),u=new URL(url),results=await Promise.allSettled([resolve4(u.hostname),resolve6(u.hostname)]),addresses=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 if(!addresses.length||addresses.some(ip=>!publicAddress(ip)))throw Error("This source resolves to a private or unavailable address");
 const response=await pinnedRequest(u,addresses[0]);if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location||redirects>=3)throw Error("Too many source redirects");return getPublicSource(new URL(location,u).href,redirects+1);}
 if(response.status>=400)throw Error("The source returned HTTP "+response.status);
 const encoding=response.headers.get('content-encoding');if(encoding&&encoding!=='identity')throw Error("Source ignored the plain-text encoding request");return{text:new TextDecoder().decode(response.body),url};
}
