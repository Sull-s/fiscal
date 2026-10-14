/**
 * Painel do administrador (uma página, sem dependências). Fala só com as rotas /v1/admin usando o
 * token que a pessoa digita; o token fica no sessionStorage da aba (some ao fechar).
 * Todo dado vindo da API entra na tela por textContent (nunca innerHTML).
 */
export const PAGINA_PAINEL = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel fiscal</title>
<style>
:root{--fundo:#f6f7f9;--cartao:#fff;--texto:#1d2330;--suave:#5b6474;--borda:#dfe3ea;--destaque:#2457d6;--critico:#c62828;--aviso:#b26a00;--ok:#1e7d3a}
@media (prefers-color-scheme:dark){:root{--fundo:#12151b;--cartao:#1b2029;--texto:#e7eaf0;--suave:#9aa3b2;--borda:#2b3240;--destaque:#7aa2ff;--critico:#ff7b72;--aviso:#e3b341;--ok:#56d364}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--fundo);color:var(--texto)}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--borda);background:var(--cartao)}
header h1{font-size:17px;margin:0}main{max-width:1100px;margin:0 auto;padding:20px 16px}
.cartao{background:var(--cartao);border:1px solid var(--borda);border-radius:10px;padding:16px;margin-bottom:16px}
h2{font-size:15px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--borda);vertical-align:top}
th{font-weight:600;color:var(--suave);font-size:12px;text-transform:uppercase;letter-spacing:.03em}
button{font:inherit;border:1px solid var(--borda);background:var(--cartao);color:var(--texto);border-radius:7px;padding:6px 12px;cursor:pointer}
button.principal{background:var(--destaque);border-color:var(--destaque);color:#fff}button:disabled{opacity:.5;cursor:default}
input,textarea,select{font:inherit;color:var(--texto);background:var(--fundo);border:1px solid var(--borda);border-radius:7px;padding:7px 9px;width:100%}
textarea{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;min-height:260px}
label{display:block;font-size:12px;color:var(--suave);margin:10px 0 4px}
.linha{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.linha>*{flex:1;min-width:180px}
.etiqueta{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:99px;border:1px solid var(--borda);margin:0 4px 4px 0}
.critico{color:var(--critico)}.aviso{color:var(--aviso)}.ok{color:var(--ok)}.suave{color:var(--suave)}
.alerta{padding:8px 10px;border-left:3px solid;border-radius:4px;margin-bottom:6px;background:var(--fundo)}
.alerta.critico{border-color:var(--critico)}.alerta.aviso{border-color:var(--aviso)}
.segredo{font-family:ui-monospace,Consolas,monospace;word-break:break-all;padding:10px;border:1px dashed var(--destaque);border-radius:7px;margin-top:8px}
#mensagem{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:8px;background:var(--texto);color:var(--fundo);display:none;max-width:90vw}
.oculto{display:none}.rolagem{overflow-x:auto}.rolagem table{min-width:560px}button.compacto{flex:0 0 auto;min-width:0}
</style>
</head>
<body>
<header><h1>Painel fiscal</h1><div><a href="/painel/testes" style="color:var(--destaque);margin-right:10px">Testar notas</a><span id="ambienteApi" class="suave"></span> <button id="sair" class="oculto">Sair</button></div></header>
<main>
  <section id="entrar" class="cartao" style="max-width:420px;margin:60px auto">
    <h2>Entrar</h2>
    <label for="token">Token do administrador (FISCAL_TOKEN_ADMIN)</label>
    <input id="token" type="password" autocomplete="off">
    <p class="suave" style="font-size:12px">O token fica só nesta aba do navegador e some quando você fecha.</p>
    <button class="principal" id="botaoEntrar">Entrar</button>
  </section>

  <section id="app" class="oculto">
    <div class="cartao"><h2>Alertas</h2><div id="alertas"></div></div>
    <div class="cartao">
      <div class="linha" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Empresas</h2><button id="novaEmpresa" class="compacto">Nova empresa</button></div>
      <div class="rolagem"><table><thead><tr><th>Empresa</th><th>Ambiente</th><th>Certificado</th><th>Módulos</th><th>Notas presas</th><th></th></tr></thead><tbody id="empresas"></tbody></table></div>
    </div>

    <div id="detalhe" class="cartao oculto">
      <h2 id="tituloDetalhe">Empresa</h2>
      <label for="idEmpresa">Identificador (letras minúsculas, números e hífen)</label>
      <input id="idEmpresa">
      <label for="cadastro">Cadastro (JSON: nome, cnpj, ambiente, nfce, nfe, nfse, dfe)</label>
      <textarea id="cadastro" spellcheck="false"></textarea>
      <div class="linha" style="margin-top:10px"><button class="principal compacto" id="salvar">Salvar cadastro</button><span id="erroCadastro" class="critico"></span></div>

      <div id="blocoCertificado">
        <h2 style="margin-top:22px">Certificado A1</h2>
        <div class="linha">
          <div><label for="pfx">Arquivo .pfx</label><input id="pfx" type="file" accept=".pfx,.p12"></div>
          <div><label for="senha">Senha do certificado</label><input id="senha" type="password" autocomplete="off"></div>
          <button id="enviarCertificado" class="compacto">Enviar</button>
        </div>
        <p id="situacaoCertificado" class="suave"></p>

        <h2 style="margin-top:22px">Chaves de API</h2>
        <table><thead><tr><th>Id</th><th>Criada em</th><th></th></tr></thead><tbody id="chaves"></tbody></table>
        <button id="gerarChave" style="margin-top:10px">Gerar nova chave</button>
        <div id="novaChave" class="oculto"><p class="aviso">Copie agora: esta chave não aparece de novo.</p><div class="segredo" id="textoChave"></div><button id="copiarChave" style="margin-top:8px">Copiar</button></div>
      </div>
    </div>
  </section>
</main>
<div id="mensagem" role="status"></div>
<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var token = sessionStorage.getItem("fiscal-token") || "";
  var atual = null;

  function aviso(texto){ var m=$("mensagem"); m.textContent=texto; m.style.display="block"; clearTimeout(aviso.t); aviso.t=setTimeout(function(){ m.style.display="none"; },4000); }
  function el(tag, texto, classe){ var e=document.createElement(tag); if(texto!==undefined) e.textContent=texto; if(classe) e.className=classe; return e; }
  async function api(metodo, caminho, corpo){
    var r = await fetch("/v1/admin"+caminho,{method:metodo,headers:Object.assign({Authorization:"Bearer "+token},corpo?{"Content-Type":"application/json"}:{}),body:corpo?JSON.stringify(corpo):undefined});
    if(r.status===401){ sair(); throw new Error("Token inválido."); }
    if(r.status===204) return null;
    var dados = await r.json().catch(function(){ return null; });
    if(!r.ok) throw new Error((dados&&dados.erro&&dados.erro.mensagem)||("Erro "+r.status));
    return dados;
  }
  function sair(){ token=""; sessionStorage.removeItem("fiscal-token"); $("app").classList.add("oculto"); $("entrar").classList.remove("oculto"); $("sair").classList.add("oculto"); }

  async function carregar(){
    var monitor = await api("GET","/monitor");
    var lista = await api("GET","/empresas");
    var caixa=$("alertas"); caixa.replaceChildren();
    if(!monitor.alertas.length) caixa.appendChild(el("p","Nenhum alerta. Tudo funcionando.","ok"));
    monitor.alertas.forEach(function(a){ caixa.appendChild(el("div",a.mensagem,"alerta "+a.gravidade)); });
    var porId={}; monitor.empresas.forEach(function(m){ porId[m.id]=m; });
    var corpo=$("empresas"); corpo.replaceChildren();
    lista.forEach(function(e){
      var m=porId[e.id]||{}; var tr=document.createElement("tr");
      var nome=el("td"); nome.appendChild(el("div",e.nome)); nome.appendChild(el("div",e.cnpj+" · "+e.id,"suave")); tr.appendChild(nome);
      tr.appendChild(el("td",e.ambiente===1?"Produção":"Homologação",e.ambiente===1?"ok":"aviso"));
      var dias=m.diasCertificado; tr.appendChild(el("td",e.certificado?(e.certificado.validoAte.slice(0,10)+" ("+dias+" dias)"):"Sem certificado",!e.certificado||dias<0?"critico":dias<=30?"aviso":""));
      var mods=el("td"); ["nfce","nfe","nfse","dfe"].forEach(function(k){ if(e[k]) mods.appendChild(el("span",k.toUpperCase().replace("NFCE","NFC-e").replace("NFSE","NFS-e").replace("NFE","NF-e").replace("DFE","DF-e"),"etiqueta")); }); tr.appendChild(mods);
      tr.appendChild(el("td",(m.pendentes||0)+" pendente(s), "+(m.offline||0)+" offline",(m.pendentes||m.offline)?"aviso":"suave"));
      var acao=el("td"); var b=el("button","Abrir"); b.onclick=function(){ abrir(e); }; acao.appendChild(b); tr.appendChild(acao);
      corpo.appendChild(tr);
    });
  }

  var MODELO = {nome:"",cnpj:"",ambiente:2,nfce:{serie:"1",contingenciaOffline:true,emitente:{cnpj:"",inscricaoEstadual:"",razaoSocial:"",crt:1,endereco:{logradouro:"",numero:"",bairro:"",codigoMunicipio:"",municipio:"",uf:"RS",cep:""}}}};
  function abrir(e){
    atual=e; $("detalhe").classList.remove("oculto");
    $("tituloDetalhe").textContent = e ? e.nome : "Nova empresa";
    $("idEmpresa").value = e ? e.id : ""; $("idEmpresa").disabled = !!e;
    var cad = e ? {nome:e.nome,cnpj:e.cnpj,ambiente:e.ambiente} : JSON.parse(JSON.stringify(MODELO));
    if(e) ["nfce","nfe","nfse","dfe"].forEach(function(k){ if(e[k]) cad[k]=e[k]; });
    $("cadastro").value = JSON.stringify(cad,null,2);
    $("erroCadastro").textContent=""; $("novaChave").classList.add("oculto");
    $("blocoCertificado").classList.toggle("oculto",!e);
    if(e){
      $("situacaoCertificado").textContent = e.certificado ? ("Atual: "+e.certificado.titular+" ("+e.certificado.documento+"), válido até "+e.certificado.validoAte.slice(0,10)) : "Nenhum certificado enviado.";
      var tb=$("chaves"); tb.replaceChildren();
      e.chavesApi.forEach(function(k){ var tr=document.createElement("tr"); tr.appendChild(el("td",k.id)); tr.appendChild(el("td",k.criadaEm.replace("T"," ").slice(0,16))); var td=el("td"); var b=el("button","Revogar"); b.onclick=async function(){ if(!confirm("Revogar a chave "+k.id+"? Sistemas que usam essa chave param de emitir.")) return; try{ await api("DELETE","/empresas/"+e.id+"/chaves/"+k.id); aviso("Chave revogada."); await recarregarAtual(); }catch(x){ aviso(x.message); } }; td.appendChild(b); tr.appendChild(td); tb.appendChild(tr); });
      if(!e.chavesApi.length){ var tr=document.createElement("tr"); var td=el("td","Nenhuma chave.","suave"); td.colSpan=3; tr.appendChild(td); tb.appendChild(tr); }
    }
    $("detalhe").scrollIntoView({behavior:"smooth"});
  }
  async function recarregarAtual(){ await carregar(); if(atual){ var e=await api("GET","/empresas/"+atual.id); abrir(e); } }

  $("botaoEntrar").onclick = async function(){ token=$("token").value.trim(); try{ await carregar(); sessionStorage.setItem("fiscal-token",token); $("entrar").classList.add("oculto"); $("app").classList.remove("oculto"); $("sair").classList.remove("oculto"); }catch(x){ aviso(x.message); } };
  $("token").onkeydown=function(ev){ if(ev.key==="Enter") $("botaoEntrar").click(); };
  $("sair").onclick = sair;
  $("novaEmpresa").onclick = function(){ abrir(null); };
  $("salvar").onclick = async function(){
    $("erroCadastro").textContent=""; var dados;
    try{ dados=JSON.parse($("cadastro").value); }catch(x){ $("erroCadastro").textContent="JSON inválido: "+x.message; return; }
    var id=$("idEmpresa").value.trim(); if(!id){ $("erroCadastro").textContent="Informe o identificador."; return; }
    try{ var e=await api("PUT","/empresas/"+encodeURIComponent(id),dados); aviso("Cadastro salvo."); atual=e; await recarregarAtual(); }catch(x){ $("erroCadastro").textContent=x.message; }
  };
  $("enviarCertificado").onclick = async function(){
    var arq=$("pfx").files[0]; if(!arq){ aviso("Escolha o arquivo .pfx."); return; }
    var bytes=new Uint8Array(await arq.arrayBuffer()); var bin=""; for(var i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
    try{ var r=await api("PUT","/empresas/"+atual.id+"/certificado",{pfxBase64:btoa(bin),senha:$("senha").value}); $("senha").value=""; $("pfx").value=""; aviso("Certificado de "+r.titular+" salvo (vence em "+r.validoAte.slice(0,10)+")."); await recarregarAtual(); }catch(x){ aviso(x.message); }
  };
  $("gerarChave").onclick = async function(){ try{ var r=await api("POST","/empresas/"+atual.id+"/chaves"); await recarregarAtual(); $("textoChave").textContent=r.chave; $("novaChave").classList.remove("oculto"); }catch(x){ aviso(x.message); } };
  $("copiarChave").onclick = function(){ navigator.clipboard.writeText($("textoChave").textContent).then(function(){ aviso("Chave copiada."); }); };

  if(token){ $("token").value=token; $("botaoEntrar").click(); }
})();
</script>
</body>
</html>`;
