'use strict';
// Flip only after the reviewed database migration and approved-user enrollment.
const INVENTORY_PRODUCTION_ENABLED=true;
window.InventoryTransport=(()=>{
 let local=false;
 async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw Error(data.error||'Server request failed');return data;}
 async function init(){if(['localhost','127.0.0.1'].includes(location.hostname)){try{const r=await fetch('/api/bootstrap');if(r.ok){const b=await r.json();local=b.local===true;if(local)return b}}catch{}}
  if(!INVENTORY_PRODUCTION_ENABLED)throw Error('Production activation is pending. This build is not connected to live inventory.');
  return {local:false};
 }
 async function rpc(action,payload={}){if(local)return post('/api/rpc',{action,payload});const verified=await window.Shared360Session.current();if(!verified)throw Error('Please sign in with your existing 360 account.');const {data,error}=await window.Shared360Session.client.rpc('inv_api',{p_action:action,p_payload:payload});if(error)throw error;return data;}
 return {init,rpc,get local(){return local},async login(id,password){if(local)return post('/api/login',{id});const {error}=await window.Shared360Session.client.auth.signInWithPassword({email:id,password});if(error)throw error;},async logout(){if(local)return post('/api/logout',{});const {error}=await window.Shared360Session.client.auth.signOut();if(error)throw error;}};
})();
