'use strict';
window.InventoryAdmin=(()=>{
 const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let api,hooks,prepared=null,request=null,manifest=null,identity=null,busy=false;
 const markup=`<div class="page-heading"><div><p class="eyebrow">PRACTICE SETUP</p><h1>Workbooks & approved users</h1></div></div>
 <p class="notice">Practice only. Every import creates a new session with blank counts. Existing sessions, saved quantities and submitted sheets stay untouched. No GP connection or GP writes.</p>
 <section id="importPanel"><h2>Upload changed Excel workbooks</h2><p>Select each site's revised .xlsx. Only the first worksheet is used; headers must match Item #, Bin Number, Item Description and On Hand. Old count columns are ignored. Files are read on this device; only validated rows and source hashes are sent privately to the inventory database.</p>
 <div class="filters">${['BIS','GF','FARGO'].map(s=>`<label>${s} workbook<input id="file${s}" type="file" accept=".xlsx" style="width:100%;min-width:0"></label>`).join('')}</div>
 <label>Practice session name<input id="importLabel" maxlength="100" value="Revised workbook practice"></label>
 <button id="previewImport" class="secondary">Validate & preview</button><div id="importPreview" aria-live="polite"></div>
 <label class="check"><input type="checkbox" id="approveImport"> I approve approximate 40-row digital sheets for practice (NOT native printed-page boundaries). Bins containing & stay together; units and on-hand are unverified reference only.</label>
 <button id="runImport" class="primary" disabled>Create fresh practice session</button><button id="cancelImport" hidden>Discard incomplete upload</button><p id="importStatus" role="status"></p></section>
 <section id="memberPanel"><h2>Approved users</h2><p>Administrator only. Look up one exact, confirmed 360 account email. Verify affiliation and authority independently before granting access. No domain-wide grants, new account creation or administrator promotion.</p><div id="memberList"></div>
 <label>Existing account email<input id="memberEmail" type="email" autocomplete="off"></label><button id="lookupMember">Verify exact account</button><p id="memberIdentity"></p>
 <label>Display name<input id="memberName" maxlength="80"></label><label>Access<select id="memberRole"><option value="counter">Counter</option><option value="accounting">Accounting (includes workbook imports)</option><option value="disabled">Disabled</option></select></label>
 <label>Verified affiliation / approval reason<input id="memberReason" minlength="5" maxlength="1000" placeholder="Who approved this person and role?"></label><button id="saveMember" class="primary" disabled>Save approved access</button></section><p id="adminMessage" role="alert"></p>`;
 async function members(){const data=await api('members');$('memberList').innerHTML='<ul>'+data.members.map(m=>`<li>${esc(m.display_name)} — ${m.active?(m.accounting?'Accounting':'Counter'):'Disabled'}${m.administrator?' · Administrator (controlled enrollment)':''}<br><small style="overflow-wrap:anywhere">${esc(m.email||'Auth account unavailable — controlled review required')}</small></li>`).join('')+'</ul>';}
 function status(s){$('importStatus').textContent=s}
 function lock(on){busy=on;for(const id of ['fileBIS','fileGF','fileFARGO','importLabel','previewImport','approveImport','runImport','cancelImport'])$(id).disabled=on||!!request&&!['runImport','cancelImport'].includes(id);}
 async function preview(){
  if(request)throw Error('Finish/retry or discard the incomplete upload first.');
  prepared=null;manifest=null;$('runImport').disabled=true;$('approveImport').checked=false;$('importPreview').textContent='Validating workbooks…';lock(true);
  try{const files=[];for(const site of ['BIS','GF','FARGO']){const file=$('file'+site).files[0];if(file)files.push(await window.InventoryWorkbook.parse(file,site))}if(!files.length)throw Error('Select at least one site workbook');if(files.reduce((n,f)=>n+f.rows.length,0)>50000)throw Error('Maximum 50,000 rows per practice session');prepared=files;
   $('importPreview').innerHTML=files.map(f=>`<p><b>${esc(f.source.site)}: ${f.rows.length.toLocaleString()} items / ${Math.ceil(f.rows.length/40)} digital sheets</b><br>${esc(f.source.filename)} · worksheet ${esc(f.source.worksheet)} · ${f.otherSheets} other worksheets ignored · ${f.issues} compound/unassigned bin entries retained as written.<br>SHA-256: <small style="overflow-wrap:anywhere">${esc(f.source.sha256)}</small></p>`).join('');status('Preview validated. Review the selected sites and approve practice grouping.');
  }catch(e){$('importPreview').textContent='Validation failed: '+e.message;throw e}finally{lock(false);$('runImport').disabled=!prepared}
 }
 async function upload(){
  if(!prepared||!$('approveImport').checked)throw Error('Validate workbooks and approve approximate practice grouping first.');
  if(!$('importLabel').value.trim())throw Error('Enter a practice session name.');
  if(!request){request=crypto.randomUUID();manifest={request,label:$('importLabel').value.trim(),practice:true,grouping:'digital-40',sources:prepared.map(f=>f.source)}}
  lock(true);let complete=false;
  try{
   status('Starting private upload…');await api('begin',manifest);const rows=prepared.flatMap(f=>f.rows);
   // Finish may have committed before a lost response. Probe the idempotent finish before retrying chunks.
   let result;try{result=await api('finish',{request})}catch(e){if(!/row count mismatch/i.test(e.message))throw e}
   if(!result){for(let i=0;i<rows.length;i+=200){status(`Uploading ${Math.min(i+200,rows.length).toLocaleString()} / ${rows.length.toLocaleString()} items…`);await api('chunk',{request,index:i/200,rows:rows.slice(i,i+200)})}result=await api('finish',{request})}
   // Read back the exact cycle and counts before claiming success.
   const check=await window.InventoryTransport.rpc('list'),sheets=check.sheets.filter(s=>s.cycle_id===result.cycle);
   if(!check.cycles.some(c=>c.id===result.cycle)||sheets.length!==result.sheets||sheets.reduce((n,s)=>n+Number(s.total),0)!==result.items)throw Error('Session readback did not match; retry verification.');
   status(`Server confirmed: ${result.items.toLocaleString()} items, ${result.sheets} fresh practice sheets. Prior sessions unchanged. Select the new PRACTICE session in Count sheets.`);
   hooks.selectCycle(result.cycle);await hooks.refresh();request=null;prepared=null;manifest=null;complete=true;$('importPreview').textContent='';for(const s of ['BIS','GF','FARGO'])$('file'+s).value='';$('approveImport').checked=false;
  }catch(e){status('NOT CONFIRMED: '+e.message+' Keep this page open and retry; the same request cannot duplicate a session.');throw e}
  finally{lock(false);$('runImport').disabled=complete;$('cancelImport').hidden=!request}
 }
 async function init(h){
  hooks=h;api=(a,p={})=>window.InventoryTransport.admin(a,p);
  if(!$('adminView')){const section=document.createElement('section');section.id='adminView';section.hidden=true;section.innerHTML=markup;$('main').append(section);const button=document.createElement('button');button.id='navAdmin';button.textContent='⚙  Workbooks & users';document.querySelector('.sidebar nav').append(button);
   const bind=(id,event,fn)=>$(id).addEventListener(event,async()=>{try{$('adminMessage').textContent='';await fn()}catch(e){$('adminMessage').textContent=e.message}});
   bind('navAdmin','click',async()=>{if(!await hooks.leaveSheet())return;hooks.show('adminView');if(!$('memberPanel').hidden)await members()});
   bind('previewImport','click',preview);bind('runImport','click',upload);
   for(const id of ['fileBIS','fileGF','fileFARGO'])bind(id,'change',()=>{if(!request){prepared=null;$('runImport').disabled=true;$('importPreview').textContent='Files changed — validate again.'}});
   bind('cancelImport','click',async()=>{try{await api('cancel',{request})}catch(e){if(!/Import not found for this actor/.test(e.message))throw e}request=null;manifest=null;prepared=null;lock(false);$('cancelImport').hidden=true;$('runImport').disabled=true;status('Incomplete upload discarded. No session was changed.')});
   bind('memberEmail','input',()=>{identity=null;$('saveMember').disabled=true;$('memberIdentity').textContent=''});
   bind('lookupMember','click',async()=>{identity=null;$('saveMember').disabled=true;const found=await api('lookup',{email:$('memberEmail').value.trim()});identity=found;$('memberIdentity').textContent=`Confirmed account: ${found.email}. Verify affiliation before granting access.`;$('saveMember').disabled=false});
   bind('saveMember','click',async()=>{if(!identity)throw Error('Look up exact account first');const role=$('memberRole').value,p={user_id:identity.id,email:identity.email,display_name:$('memberName').value.trim(),active:role!=='disabled',accounting:role==='accounting',reason:$('memberReason').value.trim()};await api('member_set',p);const data=await api('members'),m=data.members.find(m=>m.user_id===identity.id);if(!m||m.active!==p.active||m.accounting!==p.accounting||m.display_name!==p.display_name)throw Error('Membership readback mismatch');await members();$('adminMessage').textContent='Server confirmed approved access.';identity=null;$('saveMember').disabled=true});
  }
  const caps=await api('capabilities');$('navAdmin').hidden=!caps.import&&!caps.members;$('importPanel').hidden=!caps.import;$('memberPanel').hidden=!caps.members;
 }
 function reset(){prepared=null;request=null;manifest=null;identity=null;if($('adminView')){lock(false);$('approveImport').checked=false;$('adminView').hidden=true;$('memberList').textContent='';$('memberIdentity').textContent='';$('memberEmail').value='';$('memberName').value='';$('memberReason').value='';$('importPreview').textContent='';$('importStatus').textContent='';$('adminMessage').textContent='';$('saveMember').disabled=true;$('runImport').disabled=true;$('cancelImport').hidden=true;for(const s of ['BIS','GF','FARGO'])$('file'+s).value='';}}
 window.addEventListener('beforeunload',e=>{if(busy||request){e.preventDefault();e.returnValue=''}});
 return {init,reset,get busy(){return busy}};
})();
