const fs = require('fs'); const zlib = require('zlib'); const path = require('path');
function crc32(buf){let c,crc=0xffffffff;for(let n=0;n<buf.length;n++){c=(crc^buf[n])&0xff;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crc=(crc>>>8)^c;}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
function png(w,h,pixel){const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const [r,g,b]=pixel(x,y);const o=y*(w*3+1)+1+x*3;raw[o]=r;raw[o+1]=g;raw[o+2]=b;}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
// Simple "AC unit" drawing: blue gradient background, white rounded box with a dark louver line and three air-flow ticks
function draw(w,h,white=false){return png(w,h,(x,y)=>{
  const u=x/w,v=y/h; const bg=white?[255,255,255]:[26+40*v,115+30*v,232-40*v];
  const ink=white?[26,115,232]:[255,255,255];
  const bx0=0.14,bx1=0.86,by0=0.30,by1=0.62; const r=0.06*Math.min(1,w/h);
  const inBox=u>bx0&&u<bx1&&v>by0&&v<by1; if(!inBox) {
    for(const cx of [0.32,0.5,0.68]){ if(Math.abs(u-cx)<0.012 && v>0.68 && v<0.84) return ink; }
    return bg.map(Math.round); }
  const louver=Math.abs(v-0.52)<0.015 && u>bx0+0.05 && u<bx1-0.05; if(louver) return [40,60,90];
  const edge=u<bx0+0.012||u>bx1-0.012||v<by0+0.018||v>by1-0.018; if(white&&edge) return [40,60,90];
  return white?[235,240,248]:[255,255,255]; }); }
const out=(p,w,h,white=false)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,draw(w,h,white));console.log('wrote',p,w+'x'+h);};
out('assets/images/app-small.png',250,175); out('assets/images/app-large.png',500,350); out('assets/images/app-xlarge.png',1000,700);
out('drivers/ac/assets/images/small.png',75,75,true); out('drivers/ac/assets/images/large.png',500,500,true); out('drivers/ac/assets/images/xlarge.png',1000,1000,true);
