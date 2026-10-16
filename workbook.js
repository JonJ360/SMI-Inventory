'use strict';
// Dependency-free, bounded XLSX reader for the existing SMI count-sheet contract.
// Raw workbook bytes stay in the browser. Never follows external relationships.
window.InventoryWorkbook=(()=>{
 const limit=40*1024*1024;
 function xml(text){if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML entities are not supported');const d=new DOMParser().parseFromString(text,'application/xml');if(d.querySelector('parsererror'))throw Error('Malformed workbook XML');return d;}
 const nodes=(e,n)=>[...e.getElementsByTagNameNS('*',n)];
 async function unzip(buffer){
  const v=new DataView(buffer),bytes=new Uint8Array(buffer),entries=new Map();let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break}
  if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))throw Error('Not a supported XLSX ZIP');
  const count=v.getUint16(end+10,true);let pos=v.getUint32(end+16,true),total=0;
  if(count>2000)throw Error('Workbook has too many ZIP entries');
  for(let i=0;i<count;i++){
   if(pos+46>bytes.length||v.getUint32(pos,true)!==0x02014b50)throw Error('Corrupt ZIP directory');
   const flags=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),packed=v.getUint32(pos+20,true),size=v.getUint32(pos+24,true),nl=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
   const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+nl));pos+=46+nl+extra+comment;total+=size;
   if(flags&1||![0,8].includes(method)||size>limit||total>80*1024*1024||entries.has(name))throw Error('Encrypted, oversized or unsupported ZIP');
   entries.set(name,{offset,packed,size,method,crc:v.getUint32(pos-46-nl-extra-comment+16,true)});
  }
  return async name=>{
   const e=entries.get(name);if(!e)return null;
   if(e.offset+30>bytes.length||v.getUint32(e.offset,true)!==0x04034b50)throw Error('Corrupt ZIP entry');
   const start=e.offset+30+v.getUint16(e.offset+26,true)+v.getUint16(e.offset+28,true);
   if(start+e.packed>bytes.length)throw Error('Truncated ZIP entry');
   const compressed=bytes.subarray(start,start+e.packed);let output;
   if(e.method===0)output=compressed;else{
    const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();let size=0;const chunks=[];
    try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>e.size||size>limit)throw Error('Oversized expanded workbook');chunks.push(r.value)}}catch(err){await reader.cancel();throw err}
    output=new Uint8Array(size);let at=0;for(const c of chunks){output.set(c,at);at+=c.length}
   }
   if(output.length!==e.size)throw Error('Corrupt expanded workbook length');
   let crc=0xffffffff;for(const byte of output){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}if(((crc^0xffffffff)>>>0)!==e.crc)throw Error('Corrupt workbook checksum');
   return new TextDecoder('utf-8',{fatal:true}).decode(output);
  };
 }
 async function parse(file,site){
  if(!['BIS','GF','FARGO'].includes(site))throw Error('Choose an explicit site');
  if(!/\.xlsx$/i.test(file.name)||file.size>20*1024*1024)throw Error('Use an .xlsx workbook no larger than 20 MB');
  const buffer=await file.arrayBuffer(),get=await unzip(buffer),book=xml(await get('xl/workbook.xml')||''),rels=xml(await get('xl/_rels/workbook.xml.rels')||'');
  const worksheets=nodes(book,'sheet'),first=worksheets[0];if(!first)throw Error('Workbook has no worksheet');
  const rel=nodes(rels,'Relationship').find(r=>r.getAttribute('Id')===first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
  if(!rel||rel.getAttribute('TargetMode')==='External')throw Error('Missing or external worksheet relationship');
  const target=rel.getAttribute('Target');if(target.includes('..')||target.includes('\\')||target.includes(':'))throw Error('Unsupported worksheet path');
  const sheetPath=target.startsWith('/')?target.slice(1):'xl/'+target;
  const sharedText=await get('xl/sharedStrings.xml'),shared=sharedText?nodes(xml(sharedText),'si').map(s=>nodes(s,'t').map(t=>t.textContent).join('')):[];
  const styleText=await get('xl/styles.xml'),styles=styleText?xml(styleText):null;
  const formats=new Map(styles?nodes(styles,'numFmt').map(f=>[f.getAttribute('numFmtId'),f.getAttribute('formatCode')]):[]);
  const cellFormats=styles?nodes(styles,'cellXfs').flatMap(x=>nodes(x,'xf')).map(x=>formats.get(x.getAttribute('numFmtId'))||''):[];
  function value(c,identity=false){
   if(!c)return '';
   if(nodes(c,'f').length)throw Error('Formulas in source identities or on-hand require a reviewed values-only export');
   const type=c.getAttribute('t'),raw=nodes(c,'v')[0]?.textContent||'';
   if(type==='e')throw Error('Workbook contains an Excel error');
   if(type==='s'){if(shared[Number(raw)]===undefined)throw Error('Invalid shared string');return shared[Number(raw)]}
   if(type==='inlineStr')return nodes(c,'t').map(t=>t.textContent).join('');
   if(type==='str')return raw;
   if(type==='b')throw Error('Boolean source identities are unsupported');
   if(identity&&raw){const fmt=cellFormats[Number(c.getAttribute('s')||0)];if(!Number.isSafeInteger(Number(raw)))throw Error('Numeric identity must be a safe integer; export Item # as Text');if(/^0+$/.test(fmt))return String(Number(raw)).padStart(fmt.length,'0');return String(Number(raw))}
   return raw;
  }
  const sheet=xml(await get(sheetPath)||''),sheetRows=nodes(sheet,'row');
  const cells=r=>new Map(nodes(r,'c').map(c=>[(c.getAttribute('r')||'').replace(/[0-9]/g,''),c]));
  const headerRow=sheetRows.find(r=>r.getAttribute('r')==='1');if(!headerRow)throw Error('Headers must be in row 1');
  const headers=new Map();for(const [col,c] of cells(headerRow)){const name=value(c).trim().replace(/\s+/g,' ').toUpperCase();if(headers.has(name)&&name)throw Error('Duplicate header');headers.set(name,col)}
  for(const h of ['ITEM #','BIN NUMBER','ITEM DESCRIPTION','ON HAND'])if(!headers.has(h))throw Error('Missing column: '+h);
  const rows=[],seen=new Set();let compound=0;
  for(const r of sheetRows){if(r===headerRow)continue;const c=cells(r),field=(h,id=false)=>value(c.get(headers.get(h)),id),item=field('ITEM #',true);if(!item)continue;
   if(seen.has(item))throw Error('Duplicate Item # in selected site');seen.add(item);
   const bin=field('BIN NUMBER',true)||'UNASSIGNED',onhand=field('ON HAND');
   if(onhand!==''&&(!Number.isFinite(Number(onhand))||!/^[-+]?\d+(\.\d+)?(?:[eE][-+]?\d+)?$/.test(onhand)))throw Error('On Hand must be numeric or blank');
   if(bin.includes('&')||bin==='UNASSIGNED'||bin==='0')compound++;
   rows.push({site,item_number:item,description:field('ITEM DESCRIPTION'),bin,on_hand:onhand===''?null:Number(onhand),source_row:Number(r.getAttribute('r'))});
   if(rows.length>50000)throw Error('Too many source rows');
  }
  if(!rows.length)throw Error('No inventory items found');
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
  return {source:{site,filename:file.name,sha256,rows:rows.length,worksheet:first.getAttribute('name')},rows,issues:compound,otherSheets:worksheets.length-1};
 }
 return {parse};
})();
