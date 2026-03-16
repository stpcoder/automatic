import type { WebSystemDefinition } from "./system-definitions.js";

export function buildBookmarkletBridgeScript(serverOrigin: string, definition: WebSystemDefinition): string {
  const config = JSON.stringify({
    serverOrigin,
    systemId: definition.systemId,
    finalActionButton: definition.finalActionButton ?? "Submit",
    fields: definition.fields,
    buttons: definition.buttons
  });

  return `(function(){
if(window.__SKH_AGENT_BRIDGE_ACTIVE__){alert("SKH agent bridge is already running on this page.");return;}
const CONFIG=${config};
const SESSION_ID="bridge-"+Math.random().toString(36).slice(2)+"-"+Date.now();
const POLL_MS=1000;

function normalize(value){return String(value||"").trim().toLowerCase().replace(/\\s+/g," ");}
function slugify(value){return normalize(value).replace(/[^a-z0-9가-힣]+/g,"_").replace(/^_+|_+$/g,"")||"field";}
function getLabelText(element){
  if(element.getAttribute("aria-label"))return element.getAttribute("aria-label");
  if(element.id){
    const label=document.querySelector('label[for="'+element.id+'"]');
    if(label&&label.textContent)return label.textContent.trim();
  }
  const parentLabel=element.closest("label");
  if(parentLabel&&parentLabel.textContent)return parentLabel.textContent.trim();
  return element.getAttribute("placeholder")||element.name||element.id||"";
}
function resolveSemanticKey(element){
  const candidates=[getLabelText(element),element.name,element.id,element.getAttribute("aria-label"),element.getAttribute("placeholder"),element.innerText,element.textContent].map(normalize);
  for(const field of CONFIG.fields){
    const aliases=[field.key,field.label].concat(field.aliases||[]).map(normalize);
    if(aliases.some((alias)=>candidates.includes(alias))){
      return field.key;
    }
  }
  return slugify(getLabelText(element));
}
function getPageText(){
  const raw=document.body&&document.body.innerText?document.body.innerText:"";
  return raw.replace(/\\s+/g," ").trim().slice(0,4000);
}
function getObservationSignature(){
  const text=getPageText();
  return [location.href,document.title,text.slice(0,200)].join("|");
}
function buildObservation(){
  const controls=Array.from(document.querySelectorAll("input, textarea, select, button")).filter((element)=>{
    const style=window.getComputedStyle(element);
    const rect=element.getBoundingClientRect();
    return style.display!=="none"&&style.visibility!=="hidden"&&rect.width>0&&rect.height>0;
  }).map((element,index)=>{
    const tagName=element.tagName.toLowerCase();
    const type=tagName==="button"||element.type==="submit"||element.type==="button"?"button":tagName==="select"?"select":"input";
    return{
      index,
      type,
      key:resolveSemanticKey(element),
      label:getLabelText(element)||element.innerText||element.textContent||"Field",
      value:"value"in element?element.value||"":"",
      required:element.hasAttribute("required")||element.getAttribute("aria-required")==="true"
    };
  });
  const pageText=getPageText();
  const summarySnippet=pageText.length>0?pageText.slice(0,200):document.title;
  return{
    channel:"web",
    summary:document.title+" observed through bookmarklet bridge. "+summarySnippet,
    payload:{
      systemId:CONFIG.systemId,
      pageId:"live_page",
      url:location.href,
      title:document.title,
      pageText:pageText,
      interactiveElements:controls,
      finalActionButton:CONFIG.finalActionButton
    }
  };
}
async function registerSession(){
  await fetch(CONFIG.serverOrigin+"/bridge/sessions/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:SESSION_ID,system_id:CONFIG.systemId,title:document.title,url:location.href})});
}
async function pushObservation(){
  await fetch(CONFIG.serverOrigin+"/bridge/sessions/"+SESSION_ID+"/snapshot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(buildObservation())});
}
async function waitForObservationChange(previousSignature,timeoutMs){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    await new Promise((resolve)=>setTimeout(resolve,250));
    const nextSignature=getObservationSignature();
    if(nextSignature!==previousSignature){
      return true;
    }
  }
  return false;
}
function findControlForKey(key){
  const controls=Array.from(document.querySelectorAll("input, textarea, select"));
  return controls.find((control)=>resolveSemanticKey(control)===key);
}
function setControlValue(control,value){
  control.focus();
  control.value=value;
  control.dispatchEvent(new Event("input",{bubbles:true}));
  control.dispatchEvent(new Event("change",{bubbles:true}));
}
function resolveExpectedButtonLabels(expectedButton){
  const normalizedExpected=normalize(expectedButton||CONFIG.finalActionButton);
  const matchedButton=(CONFIG.buttons||[]).find((button)=>[button.key,button.label].concat(button.aliases||[]).map(normalize).includes(normalizedExpected));
  if(matchedButton){
    return [matchedButton.label].concat(matchedButton.aliases||[]).map(normalize);
  }
  return [normalizedExpected];
}
function clickSubmit(expectedButton){
  const candidates=resolveExpectedButtonLabels(expectedButton);
  const buttons=Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button']"));
  const target=buttons.find((button)=>candidates.includes(normalize(button.innerText||button.textContent||button.value)));
  if(!target){
    throw new Error("Submit button not found: "+expectedButton);
  }
  target.click();
}
function clickTarget(targetKey){
  const normalizedTarget=normalize(targetKey);
  const matchedButton=(CONFIG.buttons||[]).find((button)=>[button.key,button.label].concat(button.aliases||[]).map(normalize).includes(normalizedTarget));
  const candidateLabels=matchedButton?[matchedButton.label].concat(matchedButton.aliases||[]).map(normalize):[normalizedTarget];
  const buttons=Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button']"));
  const target=buttons.find((button)=>{
    const text=normalize(button.innerText||button.textContent||button.value);
    return candidateLabels.includes(text)||normalize(resolveSemanticKey(button))===normalizedTarget;
  });
  if(!target){
    throw new Error("Clickable element not found: "+targetKey);
  }
  target.click();
}
async function completeCommand(commandId,success,result,error){
  await fetch(CONFIG.serverOrigin+"/bridge/sessions/"+SESSION_ID+"/commands/"+commandId+"/result",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({success,result,error})});
}
async function handleCommands(){
  const response=await fetch(CONFIG.serverOrigin+"/bridge/sessions/"+SESSION_ID+"/commands");
  const commands=await response.json();
  for(const command of commands){
    try{
      if(command.type==="fill"){
        const values=command.payload.field_values||{};
        for(const [key,rawValue]of Object.entries(values)){
          const control=findControlForKey(key);
          if(control){
            setControlValue(control,String(rawValue));
          }
        }
        await completeCommand(command.command_id,true,{observation:buildObservation().payload});
      }else if(command.type==="submit"){
        const previousSignature=getObservationSignature();
        clickSubmit(String(command.payload.expected_button||CONFIG.finalActionButton));
        await waitForObservationChange(previousSignature,4000);
        await completeCommand(command.command_id,true,{observation:buildObservation().payload});
      }else if(command.type==="click"){
        const previousSignature=getObservationSignature();
        clickTarget(String(command.payload.target_key||""));
        await waitForObservationChange(previousSignature,4000);
        await completeCommand(command.command_id,true,{observation:buildObservation().payload});
      }
    }catch(error){
      await completeCommand(command.command_id,false,{},error instanceof Error?error.message:String(error));
    }
  }
}
async function loop(){
  await registerSession();
  window.__SKH_AGENT_BRIDGE_ACTIVE__=true;
  while(true){
    try{
      await pushObservation();
      await handleCommands();
    }catch(error){
      console.error("SKH bridge loop error",error);
    }
    await new Promise((resolve)=>setTimeout(resolve,POLL_MS));
  }
}
loop();
})();`;
}
