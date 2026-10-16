'use strict';
// Same project and default persistent storage key as AR. Never trust cached user claims.
window.Shared360Session=(()=>{
 const url='https://inhwadbibwkakacdvoxu.supabase.co';
 const key='sb_publishable_mvtNl3RxZB_V8xSserWVZA_8givexBq';
 const client=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
 async function current(){
  let {data,error}=await client.auth.getSession();
  // A stale SDK refresh must not hide a usable existing Asset session.
  let session=error?null:data.session;
  if(!session){
   // Asset Register predates the SDK; import its existing session through the SDK.
   let legacy=null;try{legacy=JSON.parse(localStorage.getItem('assets-auth-v1')||'null');}catch{}
   if(legacy?.access_token&&legacy?.refresh_token){
    const restored=await client.auth.setSession({access_token:legacy.access_token,refresh_token:legacy.refresh_token});
    if(restored.error)throw restored.error;
    session=restored.data.session;
    if(session)localStorage.setItem('assets-auth-v1',JSON.stringify({email:session.user.email,access_token:session.access_token,refresh_token:session.refresh_token,exp:session.expires_at*1000-60000}));
   }
  }
  if(!session){if(error)throw error;return null;}
  const verified=await client.auth.getUser();
  if(verified.error)throw verified.error;
  return {session,user:verified.data.user};
 }
 return {client,current};
})();
