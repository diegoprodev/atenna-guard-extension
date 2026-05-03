(function(){"use strict";const P=/^\/(chats|recents|settings|projects|files|artifacts|teams|upgrade)/;function R(){const e=window.location.hostname,t=window.location.pathname;return e.includes("chatgpt.com")||e.includes("chat.openai.com")?{name:"ChatGPT",inputSelector:"#prompt-textarea"}:e.includes("claude.ai")?P.test(t)?null:{name:"Claude",inputSelector:'div[contenteditable="true"]'}:e.includes("gemini.google.com")?{name:"Gemini",inputSelector:'div[contenteditable="true"]'}:null}const f="data-atenna-injected",_="atenna-guard-btn",k="atenna-btn",$=90;let v,E;function M(){try{return chrome.runtime.getURL("icons/icon128.png")}catch{return""}}function y(e){let t=e;for(;t&&t!==document.body;){const a=t.getBoundingClientRect();if((parseFloat(getComputedStyle(t).borderRadius)||0)>=8&&a.height>=36&&a.width>=200)return t;t=t.parentElement}return e}function x(e,t){E!==void 0&&cancelAnimationFrame(E),E=requestAnimationFrame(()=>{const r=y(t).getBoundingClientRect();if(r.width===0||r.height===0)return;const n=e.getBoundingClientRect().height||26;e.style.top=`${r.top-n/2}px`,e.style.right=`${window.innerWidth-r.right+$}px`})}function D(e,t){var m,b;const a=document.querySelector(e.inputSelector);if(!a)return;const r=a.parentElement;if(!r)return;if(r.hasAttribute(f)){const i=document.getElementById(_);i&&x(i,a);return}v==null||v(),v=void 0,(m=document.getElementById(_))==null||m.remove(),(b=document.querySelector(`[${f}]`))==null||b.removeAttribute(f),r.setAttribute(f,"true");const n=M(),o=document.createElement("button");if(o.id=_,o.className=k,o.setAttribute("aria-label","Atenna Prompt"),n){const i=document.createElement("img");i.className="atenna-btn__icon",i.src=n,i.width=26,i.height=26,i.alt="",i.setAttribute("aria-hidden","true"),o.appendChild(i)}o.appendChild(document.createTextNode("Atenna Prompt")),o.addEventListener("click",t),document.body.appendChild(o),Promise.resolve().then(()=>x(o,a));const d=()=>x(o,a);window.addEventListener("scroll",d,{passive:!0}),window.addEventListener("resize",d,{passive:!0});let c;typeof ResizeObserver<"u"&&(c=new ResizeObserver(d),c.observe(y(a)),c.observe(document.documentElement)),v=()=>{window.removeEventListener("scroll",d),window.removeEventListener("resize",d),c==null||c.disconnect()}}function w(e){const t=e.trim();return[{type:"Direto",label:"Direto",description:"Claro e objetivo",text:H(t)},{type:"Técnico",label:"Técnico",description:"Aprofundado e preciso",text:N(t)},{type:"Estruturado",label:"Estruturado",description:"Organizado em seções",text:B(t)}]}function H(e){return e?`Atue como especialista no tema a seguir. Responda de forma direta, objetiva e sem rodeios.

Tarefa: ${e}

Requisitos da resposta:
- Vá direto ao ponto, sem introduções genéricas
- Use linguagem clara e precisa
- Máximo de 3 parágrafos, a menos que a complexidade exija mais
- Priorize informação prática e aplicável`:"Atue como especialista no tema solicitado. Responda de forma direta, objetiva e sem rodeios — vá ao ponto sem introduções ou conclusões desnecessárias. Priorize clareza e precisão acima de tudo."}function N(e){return e?`Atue como especialista sênior com ampla experiência prática e domínio técnico profundo no tema abaixo.

Tarefa: ${e}

Inclua obrigatoriamente em sua resposta:
• Explicação técnica aprofundada com embasamento sólido
• Exemplos práticos e cenários reais aplicáveis
• Pontos de atenção, limitações e armadilhas comuns a evitar
• Recomendações baseadas em boas práticas e padrões do mercado
• Ferramentas, métodos ou abordagens relevantes quando aplicável

Use terminologia técnica precisa. Seja completo, detalhado e rigoroso.`:"Atue como especialista sênior com ampla experiência prática. Forneça uma análise técnica aprofundada incluindo: explicação técnica detalhada, exemplos práticos aplicáveis, pontos de atenção e armadilhas comuns, e recomendações baseadas em boas práticas do mercado."}function B(e){return e?`Responda à solicitação abaixo de forma estruturada, completa e bem organizada.

Solicitação: ${e}

## Contexto
Defina o cenário, os conceitos fundamentais e os pressupostos necessários para entender o tema com profundidade.

## Desenvolvimento
Aborde a solicitação com precisão e profundidade. Explore os aspectos principais, secundários e as nuances relevantes.

## Exemplos Práticos
Ilustre com casos concretos, cenários reais e exemplos aplicáveis que facilitem a compreensão e implementação.

## Conclusão e Próximos Passos
Sintetize os pontos mais importantes e sugira ações concretas, aprofundamentos ou recursos adicionais relevantes.`:"Responda de forma estruturada e abrangente usando as seções: Contexto (fundamentos), Desenvolvimento (resposta aprofundada), Exemplos Práticos (casos concretos) e Conclusão com Próximos Passos (síntese e ações)."}function j(){const e=document.getElementById("prompt-textarea");return e||(document.querySelector('div[contenteditable="true"]')??null)}function O(e){return e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement?e.value:e.innerText||e.textContent||""}function U(e,t){var a;if(e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement){const r=e instanceof HTMLTextAreaElement?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype,n=(a=Object.getOwnPropertyDescriptor(r,"value"))==null?void 0:a.set;n?n.call(e,t):e.value=t,e.dispatchEvent(new Event("input",{bubbles:!0})),e.dispatchEvent(new Event("change",{bubbles:!0}))}else{e.focus();const r=window.getSelection();if(r){const o=document.createRange();o.selectNodeContents(e),r.removeAllRanges(),r.addRange(o)}document.execCommand("insertText",!1,t)||(e.textContent=t,e.dispatchEvent(new Event("input",{bubbles:!0})))}e.focus()}const C="atenna-modal-overlay",z=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="9" y="9" width="13" height="13" rx="2"/>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
</svg>`;function F(){try{return chrome.runtime.getURL("icons/icon128.png")}catch{return""}}function G(){const t=getComputedStyle(document.body).backgroundColor.match(/\d+/g);return t&&t.length>=3?.299*+t[0]+.587*+t[1]+.114*+t[2]<128:window.matchMedia("(prefers-color-scheme: dark)").matches}function V(){const e=document.getElementById(C);if(e){e.remove();return}Y()}function Y(){var I;const e=j(),t=e?O(e):"",a=document.createElement("div");a.id=C,a.className="atenna-modal-overlay";const r=G(),n=document.createElement("div");n.className=r?"atenna-modal atenna-modal--dark":"atenna-modal",n.setAttribute("role","dialog"),n.setAttribute("aria-modal","true"),n.setAttribute("aria-label","Atenna Prompt");const o=F(),d=o?`<img src="${o}" width="22" height="22" alt="" aria-hidden="true"/>`:"";let c=w(t);n.innerHTML=`
    <div class="atenna-modal__header">
      <span class="atenna-modal__title">${d}Atenna Prompt</span>
      <div class="atenna-modal__toggle" role="tablist">
        <button class="atenna-modal__tab atenna-modal__tab--active" data-tab="prompts" role="tab" aria-selected="true">Criar Prompt</button>
        <button class="atenna-modal__tab" data-tab="edit" role="tab" aria-selected="false">Editar Texto</button>
      </div>
      <button class="atenna-modal__close" aria-label="Fechar">×</button>
    </div>

    <div class="atenna-modal__body">
      <div class="atenna-modal__view" data-view="prompts">
        <div class="atenna-modal__cards">${A(c)}</div>
      </div>

      <div class="atenna-modal__view atenna-modal__view--hidden" data-view="edit">
        <div class="atenna-modal__edit-label">Seu texto</div>
        <textarea class="atenna-modal__editor" placeholder="Digite ou edite seu texto aqui...">${u(t)}</textarea>
        <button class="atenna-modal__regen">Gerar Prompts</button>
      </div>
    </div>
  `,n.querySelector(".atenna-modal__close").addEventListener("click",()=>a.remove()),a.addEventListener("click",l=>{l.target===a&&a.remove()});const m=n.querySelectorAll(".atenna-modal__tab"),b=n.querySelectorAll(".atenna-modal__view");m.forEach(l=>{l.addEventListener("click",()=>{var h;const p=l.dataset.tab;m.forEach(s=>{s.classList.toggle("atenna-modal__tab--active",s.dataset.tab===p),s.setAttribute("aria-selected",String(s.dataset.tab===p))}),b.forEach(s=>s.classList.toggle("atenna-modal__view--hidden",s.dataset.view!==p)),p==="edit"&&((h=n.querySelector(".atenna-modal__editor"))==null||h.focus())})}),n.querySelector(".atenna-modal__regen").addEventListener("click",()=>{const p=n.querySelector(".atenna-modal__editor").value.trim();c=w(p);const h=n.querySelector(".atenna-modal__cards");h.innerHTML=A(c),T(n,()=>c,e,a),m.forEach(s=>{s.classList.toggle("atenna-modal__tab--active",s.dataset.tab==="prompts"),s.setAttribute("aria-selected",String(s.dataset.tab==="prompts"))}),b.forEach(s=>s.classList.toggle("atenna-modal__view--hidden",s.dataset.view!=="prompts"))}),T(n,()=>c,e,a),a.appendChild(n),document.body.appendChild(a);const i=l=>{l.key==="Escape"&&(a.remove(),document.removeEventListener("keydown",i))};document.addEventListener("keydown",i),a.addEventListener("remove",()=>document.removeEventListener("keydown",i)),(I=n.querySelector(".atenna-modal__close"))==null||I.focus()}function A(e){return e.map((t,a)=>`
    <div class="atenna-modal__card" data-card="${a}">
      <div class="atenna-modal__card-header">
        <div class="atenna-modal__card-meta">
          <span class="atenna-modal__card-badge">${u(t.label)}</span>
          <span class="atenna-modal__card-desc">${u(t.description)}</span>
        </div>
        <div class="atenna-modal__card-actions">
          <button class="atenna-modal__btn-copy" data-copy="${a}" aria-label="Copiar ${u(t.label)}">${z}</button>
          <button class="atenna-modal__btn-use" data-use="${a}" aria-label="Usar ${u(t.label)}">USAR</button>
        </div>
      </div>
      <div class="atenna-modal__card-text">${u(t.text)}</div>
    </div>
  `).join("")}function T(e,t,a,r){e.querySelectorAll("[data-copy]").forEach(n=>{n.addEventListener("click",()=>{var d;const o=t()[Number(n.dataset.copy)].text;try{Promise.resolve((d=navigator.clipboard)==null?void 0:d.writeText(o)).then(()=>g("Copiado ✓")).catch(()=>{L(o),g("Copiado ✓")})}catch{L(o),g("Copiado ✓")}})}),e.querySelectorAll("[data-use]").forEach(n=>{n.addEventListener("click",()=>{const o=t()[Number(n.dataset.use)].text;a?(U(a,o),r.remove()):g("Input não encontrado — use Copiar")})})}function L(e){const t=document.createElement("textarea");t.value=e,t.style.cssText="position:fixed;top:-9999px;left:-9999px;opacity:0",document.body.appendChild(t),t.select(),document.execCommand("copy"),t.remove()}function g(e){var a;(a=document.querySelector(".atenna-modal-toast"))==null||a.remove();const t=document.createElement("div");t.className="atenna-modal-toast",t.textContent=e,document.body.appendChild(t),setTimeout(()=>t.remove(),1900)}function u(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]??t)}function S(){const e=R();!e||!document.querySelector(e.inputSelector)||D(e,()=>V())}function q(){S(),new MutationObserver(()=>{S()}).observe(document.body,{childList:!0,subtree:!0})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",q):q()})();
