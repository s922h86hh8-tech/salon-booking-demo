// Pure JavaScript SHA256/base64 helper for source-side CSP hash calculation.
// Do not load in public demo; this has no network dependency.

function utf8(s){
 const a=[];
 for(let i=0;i<s.length;i++){
  let c=s.charCodeAt(i);
  if(c>=0xd800&&c<=0xdbff&&i+1<s.length){
   let d=s.charCodeAt(i+1);
   if(d>=0xdc00&&d<=0xdfff){c=65536+((c-0xd800)<<10)+(d-0xdc00);i++;}
  }
  if(c<128)a.push(c);
  else if(c<2048)a.push(192|(c>>6),128|(c&63));
  else if(c<65536)a.push(224|(c>>12),128|((c>>6)&63),128|(c&63));
  else a.push(240|(c>>18),128|((c>>12)&63),128|((c>>6)&63),128|(c&63));
 }
 return a;
}
function sha256(s){
 const a=utf8(s),bits=a.length*8;a.push(128);
 while(a.length%64!==56)a.push(0);
 for(const x of [Math.floor(bits/2**32),bits>>>0])a.push(x>>>24&255,x>>>16&255,x>>>8&255,x&255);
 const K=[],H=[];
 for(let p=2;K.length<64;p++){
  let prime=true;
  for(let j=2;j*j<=p;j++)if(p%j===0){prime=false;break;}
  if(prime){
   K.push((Math.pow(p,1/3)%1*2**32)>>>0);
   if(H.length<8)H.push((Math.sqrt(p)%1*2**32)>>>0);
  }
 }
 const R=(v,n)=>v>>>n|v<<(32-n),w=new Array(64);
 for(let off=0;off<a.length;off+=64){
  for(let i=0;i<16;i++)w[i]=(a[off+4*i]<<24|a[off+4*i+1]<<16|a[off+4*i+2]<<8|a[off+4*i+3])>>>0;
  for(let i=16;i<64;i++){
   let v=w[i-15],z=w[i-2];
   w[i]=(w[i-16]+(R(v,7)^R(v,18)^(v>>>3))+w[i-7]+(R(z,17)^R(z,19)^(z>>>10)))>>>0;
  }
  let [aa,bb,c,d,e,f,g,h]=H;
  for(let i=0;i<64;i++){
   let t1=(h+(R(e,6)^R(e,11)^R(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0;
   let t2=((R(aa,2)^R(aa,13)^R(aa,22))+((aa&bb)^(aa&c)^(bb&c)))>>>0;
   h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=bb;bb=aa;aa=(t1+t2)>>>0;
  }
  for(const [i,v] of [aa,bb,c,d,e,f,g,h].entries())H[i]=(H[i]+v)>>>0;
 }
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 const v=H.flatMap(x=>[x>>>24&255,x>>>16&255,x>>>8&255,x&255]),out=[];
 for(let i=0;i<v.length;i+=3){
  let n=v[i]<<16|((v[i+1]||0)<<8)|(v[i+2]||0);
  out.push(alphabet[n>>>18&63],alphabet[n>>>12&63],i+1<v.length?alphabet[n>>>6&63]:"=",i+2<v.length?alphabet[n&63]:"=");
 }
 return out.join("");
}

if(typeof module==='object' && module.exports)module.exports={sha256};
