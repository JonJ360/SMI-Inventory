'use strict';
(()=>{
 const $=id=>document.getElementById(id),T=window.InventoryTransport;
 const state={data:null,cycle:'',page:0,view:'dashboard',detail:null,lease:null,dirty:new Set(),saving:new Set(),account:null,accountPage:0,pending:new Map(),device:crypto.randomUUID(),online:false};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=s=>s?new Date(s).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
 let toastTimer,polling=false,heartbeat=false;
 function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,7000)}
 function connection(ok){state.online=ok;$('connection').textContent=ok?'Server connected · refreshed '+time(new Date()):'Connection interrupted · saves not confirmed';$('connection').classList.toggle('bad',!ok)}
 async function rpc(action,p={}){try{const data=await T.rpc(action,p);connection(true);return data}catch(e){if(/fetch|network|timeout|abort|load failed/i.test(e.message))connection(false);throw e}}
 const cycle=()=>state.data?.cycles.find(c=>c.id===state.cycle);
 function show(name){state.view=name;for(const id of ['dashboard','countView','accountingView','adminView'])if($(id))$(id).hidden=id!==name;$('navSheets').classList.toggle('selected',['dashboard','countView'].includes(name));$('navAccounting').classList.toggle('selected',name==='accountingView');$('navAdmin')?.classList.toggle('selected',name==='adminView');window.scrollTo(0,0)}
 function mayLeave(){return !state.saving.size&&(!state.dirty.size||confirm('There are quantities not confirmed by the server. Leave and discard these unsaved edits?'))}
 async function refresh(){if(polling)return;polling=true;try{
  const data=await rpc('list');state.data=data;
  if(!data.cycles.some(c=>c.id===state.cycle))state.cycle=data.cycles.find(c=>c.state==='open')?.id||data.cycles[0]?.id||'';
  $('cycle').innerHTML=data.cycles.map(c=>`<option value="${esc(c.id)}">${esc(c.label)}${c.state==='draft'?' · draft':''}</option>`).join('');$('cycle').value=state.cycle;
  $('userName').textContent=data.user.name;$('navAccounting').hidden=!data.user.accounting;
  if(state.view==='dashboard')renderDashboard();
 }finally{polling=false}}
 function sheetStatus(s){if(s.status==='submitted')return 'submitted';if(Date.parse(s.lease_until)>Date.now())return 'active';return 'available'}
 function metric(label,value,note){return `<div class="metric"><p class="eyebrow">${esc(label)}</p><strong>${esc(value)}</strong><span>${esc(note)}</span></div>`}
 function renderDashboard(){if(!state.data)return;
  const sheets=state.data.sheets.filter(s=>s.cycle_id===state.cycle&&(!$('site').value||s.site===$('site').value));
  const submitted=sheets.filter(s=>s.status==='submitted').length,active=sheets.filter(s=>sheetStatus(s)==='active').length;
  const total=sheets.reduce((n,s)=>n+Number(s.total),0),counted=sheets.reduce((n,s)=>n+Number(s.counted),0);
  $('metrics').innerHTML=metric('Count sheets',sheets.length,'In selected location')+metric('Ready to count',cycle()?.state==='open'&&cycle()?.mapping_approved?sheets.length-submitted-active:0,cycle()?.state==='open'&&cycle()?.mapping_approved?'Available for checkout':'Draft / closed · checkout disabled')+metric('In progress',active,'Exclusive active checkouts')+metric('Submitted',submitted,`${counted.toLocaleString()} / ${total.toLocaleString()} entries saved`);
  $('cycleNotice').hidden=cycle()?.state==='open'&&cycle()?.mapping_approved;
  $('cycleNotice').textContent='Reference / draft cycle — counting is disabled. Source mapping, units and the new-cycle baseline need approval. Prior-year quantities have not been carried forward.';
  const q=$('search').value.toLowerCase();const filtered=sheets.filter(s=>(!$('status').value||sheetStatus(s)===$('status').value)&&`${s.label} ${s.bin} ${s.site}`.toLowerCase().includes(q));
  const pages=Math.max(1,Math.ceil(filtered.length/24));state.page=Math.min(state.page,pages-1);
  $('tiles').innerHTML=filtered.slice(state.page*24,state.page*24+24).map(s=>{
   const status=sheetStatus(s),draft=cycle()?.state!=='open';const text=draft?'Draft':status==='active'?'Checked out':status==='submitted'?'Submitted':'Available';
   return `<article class="sheet-tile"><div class="tile-top"><span>${esc(s.site)}</span><span class="badge ${draft?'draft':status==='active'?'active':status==='submitted'?'locked':''}">${text}</span></div><div><h3>${esc(s.label)}</h3><p class="bin" title="${esc(s.bin)}">${esc(s.bin)}</p></div><div><div class="tile-progress"><span>${s.counted} of ${s.total} counted</span><span>${s.total?Math.round(s.counted/s.total*100):0}%</span></div><progress value="${s.counted}" max="${s.total||1}" aria-label="Count progress"></progress></div><div class="tile-owner">${status==='active'?'● '+esc(s.owner_name)+' · until '+time(s.lease_until):status==='submitted'?'✓ Reviewed '+esc(s.initials)+' · '+time(s.submitted_at):draft?'Mapping review · read only':'No one is working on this sheet'}</div><button data-sheet="${esc(s.id)}" class="${!draft&&status==='available'?'primary':'secondary'}">${status==='submitted'?'View submitted sheet':status==='active'?'View checkout':draft?'Inspect source sheet':'Open sheet →'}</button></article>`;
  }).join('')||'<div class="empty">No sheets match these filters.</div>';
  $('pageInfo').textContent=`Page ${state.page+1} of ${pages} · ${filtered.length} sheets`;$('prev').disabled=state.page===0;$('next').disabled=state.page>=pages-1;
  $('statusTime').textContent='Live status · '+time(state.data.server_time);
 }
 function leasePayload(){return {sheet:state.detail.sheet.id,device:state.device,fence:state.lease?.fence}}
 function editable(){return !!state.lease&&state.detail?.sheet.status!=='submitted'&&Date.parse(state.lease.lease_until)>Date.now()}
 async function openSheet(id){if(!mayLeave())return;state.detail=await rpc('sheet',{sheet:id});state.lease=null;state.dirty.clear();state.pending.clear();$('onlyBlank').checked=false;show('countView');renderSheet();}
 function unresolved(l){return !l.bin||l.bin==='0'||l.bin==='UNASSIGNED'||l.bin.includes('&')}
 function renderSheet(){const {sheet:s,lines}=state.detail;
  $('sheetNotice').textContent=lines.some(unresolved)?'Source Bin Number is shown exactly as imported. Separate Bin 1/2/3 counts are not configured for unresolved locations. Do not treat a combined expression as a verified single bin or allocate a saved count across it. Physical mapping needs confirmation. Existing quantities are unchanged.':'Count in the unit shown. Blank is not zero. No inventory quantities are saved until the server confirms.';
  $('sheetTitle').textContent=`${s.site} / ${s.label}`;$('sheetSubtitle').textContent=`${s.bin} · ${lines.length} count assignments · source order preserved`;
  $('lines').innerHTML=lines.map(l=>`<article class="count-line" data-line="${esc(l.id)}"><div class="item-info"><span class="item-number">${esc(l.item_number)}</span><p class="description">${esc(l.description)}</p></div><div><p class="eyebrow">${unresolved(l)?'SOURCE BIN · UNRESOLVED':'COUNT LOCATION'}</p><p class="location">${esc(l.bin)}</p><span class="subtle">${esc(l.uom)}</span></div><label>Quantity<input class="quantity" type="text" inputmode="decimal" autocomplete="off" placeholder="Not counted" value="${esc(l.quantity)}" aria-label="Quantity for ${esc(l.item_number)}"></label><label class="notes-label">Note / unit check<input class="note" maxlength="1000" value="${esc(l.note)}" placeholder="Optional context" aria-label="Note for ${esc(l.item_number)}"></label><button class="save-button primary" data-save="${esc(l.id)}">Save quantity</button><div class="save-state ${l.saved_at?'ok':''}" role="status">${l.saved_at?'✓ Server confirmed · '+esc(l.saved_by)+' · '+time(l.saved_at)+' · revision '+l.revision:l.quantity===null?'Not counted — enter zero only if checked and empty.':'Server saved'}</div></article>`).join('');updateControls();
 }
 function updateControls(){if(!state.detail)return;const s=state.detail.sheet,can=editable(),sheetCycle=state.data.cycles.find(c=>c.id===s.cycle_id),draft=sheetCycle?.state!=='open'||!sheetCycle?.mapping_approved;
  $('acquire').hidden=can||s.status==='submitted'||draft;$('release').hidden=!can;$('reopen').hidden=!state.data.user.accounting||s.status!=='submitted'||draft;
  $('leaseStatus').textContent=s.status==='submitted'?'Submitted · locked':can?'Your exclusive checkout · until '+time(state.lease.lease_until):draft?'Draft · read only':'Read only · check out to count';
  $('leaseStatus').className='badge '+(can?'active':'locked');
  let complete=0;for(const l of state.detail.lines){if(l.quantity!==null)complete++;const row=document.querySelector(`[data-line="${CSS.escape(l.id)}"]`);if(!row)continue;const busy=state.saving.has(l.id);for(const input of row.querySelectorAll('input'))input.disabled=!can||busy;row.querySelector('button').disabled=!can||busy||!state.dirty.has(l.id);row.classList.toggle('dirty',state.dirty.has(l.id));row.hidden=$('onlyBlank').checked&&l.quantity!==null&&!state.dirty.has(l.id);}
  $('countProgress').textContent=`${complete} / ${state.detail.lines.length} counted · ${state.dirty.size} unsaved`;
  $('review').disabled=!can||complete!==state.detail.lines.length||!!state.dirty.size||!!state.saving.size;
 }
 async function acquire(){if(state.dirty.size&&!confirm('Re-checkout will reload server values and discard unsaved edits. Continue?'))return;state.lease=await rpc('acquire',{sheet:state.detail.sheet.id,device:state.device});state.detail=await rpc('sheet',{sheet:state.detail.sheet.id});state.dirty.clear();renderSheet();toast('Exclusive checkout confirmed by server.');}
 async function save(id){if(state.saving.has(id))return;const l=state.detail.lines.find(l=>l.id===id),row=document.querySelector(`[data-line="${CSS.escape(id)}"]`),raw=row.querySelector('.quantity').value.trim();
  if(raw!==''&&!/^\d+(\.\d{1,4})?$/.test(raw)){toast('Use a nonnegative quantity with up to four decimals, or leave blank.');return}
  const qty=raw===''?null:Number(raw);if(qty!==null&&(!Number.isFinite(qty)||qty>999999999)){toast('Quantity is outside the allowed range.');return}
  const note=row.querySelector('.note').value;let p=state.pending.get(id);
  if(!p||p.quantity!==qty||p.note!==note||p.fence!==state.lease?.fence)p={...leasePayload(),line:id,revision:l.revision,quantity:qty,note,request:crypto.randomUUID()};state.pending.set(id,p);
  state.saving.add(id);updateControls();row.querySelector('.save-state').textContent='Saving… waiting for server confirmation';
  try{const receipt=await rpc('save',p);l.quantity=receipt.quantity;l.revision=receipt.revision;l.note=receipt.note;l.saved_at=receipt.saved_at;l.saved_by=state.data.user.name;state.dirty.delete(id);state.pending.delete(id);const label=row.querySelector('.save-state');label.textContent=`✓ Server confirmed · ${time(receipt.saved_at)} · revision ${receipt.revision}${receipt.quantity===null?' · returned to uncounted':''}`;label.className='save-state ok';toast('Quantity saved and confirmed by server.');}
  catch(e){const label=row.querySelector('.save-state');label.textContent='NOT CONFIRMED — '+e.message+' Your edit remains here. Retry, or reload the sheet to check server state.';label.className='save-state error';toast(e.message);if(/lease|submitted|approved|sign in/i.test(e.message))state.lease=null;}
  finally{state.saving.delete(id);updateControls();}
 }
 async function release(){if(!mayLeave())return;await rpc('release',leasePayload());state.lease=null;state.dirty.clear();state.detail=await rpc('sheet',{sheet:state.detail.sheet.id});renderSheet();toast('Sheet released. Saved quantities remain on the server.');}
 async function leaveSheet(){if(!mayLeave())return false;if(editable())await release();state.lease=null;state.detail=null;state.dirty.clear();state.pending.clear();return true;}
 async function account(){if(!await leaveSheet())return;state.account=await rpc('accounting',{cycle:state.cycle});show('accountingView');const items=state.account.items;
  $('accountSummary').innerHTML=metric('Items',items.length,'Selected cycle')+metric('Complete',items.filter(i=>i.complete).length,'All bins submitted')+metric('Awaiting bins',items.filter(i=>!i.complete).length,'No early variance flags')+metric('Differences',items.filter(i=>i.complete&&i.variance!==null&&Number(i.variance)!==0).length,'Review units before recount');
  state.accountPage=0;$('accountSearch').value='';renderAccountRows();
  $('audit').innerHTML=state.account.audit.map(a=>`<div class="audit-row"><b>${esc(a.action)} · ${esc(a.sheet_id)}</b><span>${esc(a.display_name)} · ${esc(new Date(a.at).toLocaleString())}</span>${a.detail.reason?'<p>'+esc(a.detail.reason)+'</p>':''}</div>`).join('')||'<p class="subtle">No count changes yet.</p>';
 }
 function accountLocations(i){const lines=state.account.lines.filter(l=>l.site===i.site&&l.item_number===i.item_number);return lines.map((l,n)=>`<div class="bin-detail"><b>${unresolved(l)?'Source Bin Number (unresolved)':`Bin ${n+1} location`}:</b> ${esc(l.bin)}<br><span>Saved ${unresolved(l)?'assignment ':''}count: ${l.quantity===null?'Not counted':esc(l.quantity)}</span>${unresolved(l)?'<br><span>Separate Bin 1/2/3 locations and counts need confirmation.</span>':''}</div>`).join('')}
 function renderAccountRows(){const q=$('accountSearch').value.toLowerCase();const items=state.account.items.filter(i=>`${i.site} ${i.item_number} ${i.description}`.toLowerCase().includes(q));const pages=Math.max(1,Math.ceil(items.length/100));state.accountPage=Math.min(state.accountPage,pages-1);
  $('accountPageInfo').textContent=`Page ${state.accountPage+1} of ${pages} · ${items.length} items`;$('accountPrev').disabled=state.accountPage===0;$('accountNext').disabled=state.accountPage>=pages-1;
  $('accountRows').innerHTML=items.slice(state.accountPage*100,state.accountPage*100+100).map(i=>`<tr><td><b>${esc(i.site)}</b>${esc(i.item_number)}</td><td>${esc(i.description)}<br><span class="subtle">${esc(i.uom)}</span></td><td>${accountLocations(i)}</td><td>${i.counted_bins} / ${i.bins}</td><td>${i.complete?esc(i.total):'—'}</td><td>${esc(i.on_hand??'Unverified')}</td><td>${i.complete?esc(i.variance??'Unverified'):'—'}</td><td><span class="badge ${i.complete?'locked':'active'}">${i.complete?'Complete':'Awaiting bins'}</span></td></tr>`).join('')||'<tr><td colspan="8">No items in this cycle.</td></tr>';
 }
 function exportCSV(){if(!state.account)return;const columns=['usage','cycle','source_hash','exported_at','site','item_number','description','uom','sheet','bin','source_key','source_row','status','quantity','revision','note','saved_by','saved_at','initials','submitted_at'];const stamp=new Date().toISOString();
  const safe=v=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
  const rows=state.account.lines.map(l=>({...l,usage:'TEST/PRACTICE ONLY - NOT OPERATIONAL STOCK',cycle:state.cycle,source_hash:cycle().source_hash,exported_at:stamp}));
  const csv='\uFEFF'+[columns.map(safe).join(','),...rows.map(r=>columns.map(c=>safe(r[c])).join(','))].join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`SMI-counts-${state.cycle}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Exported current server snapshot. Import Item Number as Text in Excel to preserve leading zeros.');
 }
 async function signedIn(){await refresh();try{await window.InventoryAdmin.init({leaveSheet,show,refresh,selectCycle:id=>{state.cycle=id}})}catch(e){if($('navAdmin'))$('navAdmin').hidden=true;toast('Workbook/user setup unavailable: '+e.message)}$('login').hidden=true;$('workspace').hidden=false;$('practiceBanner').hidden=false;$('practiceBanner').textContent=T.local?'LOCAL TEST — not production authentication':'TEST / PRACTICE · Source on-hand is unverified reference · NOT operational stock. Counts are practice only. No GP writes.';show('dashboard');renderDashboard();}
 function bind(id,event,fn){$(id).addEventListener(event,async e=>{try{await fn(e)}catch(err){toast(err.message)}})}
 bind('practiceSignIn','click',async()=>{await T.login($('practiceUser').value);await signedIn()});
 bind('signInForm','submit',async e=>{e.preventDefault();try{await T.login($('email').value,$('password').value);$('password').value='';await signedIn()}catch(err){$('loginMessage').textContent=err.message}});
 bind('logout','click',async()=>{if(window.InventoryAdmin.busy){toast('Wait for the upload to finish before signing out.');return}if(!mayLeave())return;if(editable())await release();await T.logout();window.InventoryAdmin.reset();state.data=null;state.detail=null;state.lease=null;state.dirty.clear();$('workspace').hidden=true;$('login').hidden=false;});
 bind('refresh','click',refresh);for(const id of ['cycle','site','status'])bind(id,'change',()=>{state.cycle=$('cycle').value;state.page=0;renderDashboard()});bind('search','input',()=>{state.page=0;renderDashboard()});
 bind('prev','click',()=>{state.page--;renderDashboard()});bind('next','click',()=>{state.page++;renderDashboard()});
 bind('tiles','click',e=>{const b=e.target.closest('[data-sheet]');if(b)return openSheet(b.dataset.sheet)});
 bind('back','click',async()=>{if(!mayLeave())return;if(editable())await release();state.dirty.clear();state.detail=null;show('dashboard');await refresh()});
 bind('navSheets','click',async()=>{if(!await leaveSheet())return;show('dashboard');await refresh()});bind('navAccounting','click',account);bind('export','click',exportCSV);
 bind('accountSearch','input',()=>{state.accountPage=0;renderAccountRows()});bind('accountPrev','click',()=>{state.accountPage--;renderAccountRows()});bind('accountNext','click',()=>{state.accountPage++;renderAccountRows()});
 bind('acquire','click',acquire);bind('release','click',release);bind('onlyBlank','change',updateControls);
 bind('lines','input',e=>{const row=e.target.closest('[data-line]');if(!row)return;state.dirty.add(row.dataset.line);row.querySelector('.save-state').className='save-state';row.querySelector('.save-state').textContent='Unsaved edit · not confirmed by server';updateControls()});
 bind('lines','click',e=>{const b=e.target.closest('[data-save]');if(b)return save(b.dataset.save)});
 bind('lines','keydown',async e=>{if((e.key==='Enter'||(e.key==='Tab'&&!e.shiftKey&&e.target.matches('.quantity')))&&e.target.matches('.quantity,.note')){e.preventDefault();const row=e.target.closest('[data-line]'),id=row.dataset.line;const inputs=[...document.querySelectorAll('.count-line:not([hidden]) .quantity')];const next=inputs[inputs.indexOf(row.querySelector('.quantity'))+1];if(state.dirty.has(id))await save(id);if(state.dirty.has(id)){e.target.focus();return}if(next&&!next.disabled){next.focus();next.select()}else $('review').focus()}});
 bind('review','click',()=>{$('reviewSummary').textContent=`${state.detail.sheet.label}: ${state.detail.lines.length} entries saved, including ${state.detail.lines.filter(l=>l.quantity!==null&&Number(l.quantity)===0).length} explicit zeros.`;$('initials').value='';$('reviewCheck').checked=false;$('reviewDialog').showModal()});
 bind('cancelReview','click',()=>$('reviewDialog').close());
 bind('submitForm','submit',async e=>{e.preventDefault();$('confirmSubmit').disabled=true;try{await rpc('submit',{...leasePayload(),initials:$('initials').value});state.lease=null;$('reviewDialog').close();state.detail=await rpc('sheet',{sheet:state.detail.sheet.id});renderSheet();toast('Server confirmed: submitted to accounting and locked.')}finally{$('confirmSubmit').disabled=false}});
 bind('reopen','click',()=>{$('reason').value='';$('reopenDialog').showModal()});bind('cancelReopen','click',()=>$('reopenDialog').close());bind('reopenForm','submit',async e=>{e.preventDefault();await rpc('reopen',{sheet:state.detail.sheet.id,reason:$('reason').value});$('reopenDialog').close();state.detail=await rpc('sheet',{sheet:state.detail.sheet.id});state.lease=null;renderSheet();toast('Reopened with audit reason. Check out before changing quantities.');});
 window.addEventListener('beforeunload',e=>{if(state.dirty.size||state.saving.size){e.preventDefault();e.returnValue=''}});window.addEventListener('offline',()=>{connection(false);toast('Offline. Do not leave unsaved quantities. Saves require a server confirmation.')});
 setInterval(async()=>{if(!state.data)return;try{await refresh()}catch(e){connection(false)}},5000);
 setInterval(async()=>{if(!state.lease||heartbeat||!state.detail)return;heartbeat=true;try{state.lease=await rpc('heartbeat',leasePayload());updateControls()}catch(e){state.lease=null;updateControls();toast('Checkout no longer confirmed: '+e.message)}finally{heartbeat=false}},25000);
 (async()=>{try{const mode=await T.init();$('login').hidden=false;$('practiceLogin').hidden=!mode.local;$('signInForm').hidden=mode.local;if(mode.local)$('practiceUser').innerHTML=mode.accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');try{await signedIn()}catch(e){$('loginMessage').textContent=mode.local?'Choose a practice account to explore the full workflow.':e.message}}catch(e){$('login').hidden=false;$('loginMessage').textContent=e.message}})();
})();
