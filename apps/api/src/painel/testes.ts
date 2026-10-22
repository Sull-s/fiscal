/**
 * Tela de testes (/painel/testes): emite, consulta, imprime, corrige e cancela NFC-e, NF-e e NFS-e
 * de qualquer empresa cadastrada, e roda um teste completo de uma vez. Por padrão tudo vai para
 * HOMOLOGAÇÃO (cabeçalho Fiscal-Ambiente: 2), mesmo com a empresa em produção.
 *
 * Usa o token do administrador (o mesmo do painel, no sessionStorage da aba) só para listar as
 * empresas e gerar uma chave de API própria da tela, guardada neste navegador. Todo dado vindo da
 * API entra na tela por textContent (nunca innerHTML). Sem crases nem barras invertidas no script:
 * ele vive dentro de um template literal.
 */
export const PAGINA_TESTES = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Testar notas fiscais</title>
<style>
:root{--fundo:#f6f7f9;--cartao:#fff;--texto:#1d2330;--suave:#5b6474;--borda:#dfe3ea;--destaque:#2457d6;--critico:#c62828;--aviso:#b26a00;--ok:#1e7d3a}
@media (prefers-color-scheme:dark){:root{--fundo:#12151b;--cartao:#1b2029;--texto:#e7eaf0;--suave:#9aa3b2;--borda:#2b3240;--destaque:#7aa2ff;--critico:#ff7b72;--aviso:#e3b341;--ok:#56d364}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--fundo);color:var(--texto)}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--borda);background:var(--cartao);flex-wrap:wrap}
header h1{font-size:17px;margin:0}header nav{display:flex;gap:8px;align-items:center}
main{max-width:1100px;margin:0 auto;padding:20px 16px}
a{color:var(--destaque)}
.cartao{background:var(--cartao);border:1px solid var(--borda);border-radius:10px;padding:16px;margin-bottom:16px;min-width:0}
h2{font-size:15px;margin:0 0 12px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--borda);vertical-align:top}
th{font-weight:600;color:var(--suave);font-size:12px;text-transform:uppercase;letter-spacing:.03em}
.rolagem{overflow-x:auto}
button{font:inherit;border:1px solid var(--borda);background:var(--cartao);color:var(--texto);border-radius:7px;padding:6px 12px;cursor:pointer;margin:2px 4px 2px 0}
button.principal{background:var(--destaque);border-color:var(--destaque);color:#fff}button.perigo{color:var(--critico)}
button:disabled{opacity:.5;cursor:default}
input,select{font:inherit;color:var(--texto);background:var(--fundo);border:1px solid var(--borda);border-radius:7px;padding:7px 9px;width:100%}
label{display:block;font-size:12px;color:var(--suave);margin:10px 0 4px}
.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0 12px}
.abas{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.abas button[aria-pressed=true]{background:var(--destaque);border-color:var(--destaque);color:#fff}
.ambiente{display:flex;gap:10px;flex-wrap:wrap}
.ambiente label{display:flex;gap:8px;align-items:center;margin:0;padding:10px 12px;border:1px solid var(--borda);border-radius:8px;color:var(--texto);font-size:14px;cursor:pointer;flex:1;min-width:220px}
.ambiente input{width:auto}
.faixa{padding:10px 12px;border-radius:8px;margin-top:12px;border-left:4px solid}
.faixa.teste{border-color:var(--ok);background:var(--fundo)}.faixa.producao{border-color:var(--critico);background:var(--fundo)}
.critico{color:var(--critico)}.aviso{color:var(--aviso)}.ok{color:var(--ok)}.suave{color:var(--suave)}
.oculto{display:none}
ol.passos{margin:8px 0 0;padding-left:22px}ol.passos li{margin:3px 0}
#mensagem{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:8px;background:var(--texto);color:var(--fundo);display:none;max-width:90vw;z-index:9}
</style>
</head>
<body>
<header>
  <h1>Testar notas fiscais</h1>
  <nav><a href="/painel">Painel</a><button id="sair" class="oculto" type="button">Sair</button></nav>
</header>
<main>
  <section id="entrar" class="cartao">
    <h2>Entrar</h2>
    <label for="token">Senha do painel (token do administrador)</label>
    <input id="token" type="password" autocomplete="off">
    <p><button id="botaoEntrar" class="principal" type="button">Entrar</button></p>
  </section>

  <div id="app" class="oculto">
    <section class="cartao">
      <h2>1. Empresa e ambiente</h2>
      <label for="empresa">Empresa</label>
      <select id="empresa"></select>
      <p id="infoEmpresa" class="suave"></p>
      <div class="ambiente" role="radiogroup" aria-label="Ambiente">
        <label><input type="radio" name="amb" value="2" checked> <span><strong>Teste</strong> (homologação): sem valor fiscal</span></label>
        <label><input type="radio" name="amb" value="1"> <span><strong>Produção</strong>: vale de verdade</span></label>
      </div>
      <div id="faixa" class="faixa teste"></div>
      <p><button id="status" type="button">Ver se a SEFAZ está no ar</button> <span id="statusTexto" class="suave"></span></p>
    </section>

    <section class="cartao">
      <h2>2. Testar tudo de uma vez</h2>
      <p class="suave">Para cada nota configurada: emite, consulta, baixa o XML e o documento, faz a carta de correção (NF-e) e cancela. Só no ambiente de teste.</p>
      <button id="testarTudo" class="principal" type="button">Testar todas as notas</button>
      <ol id="passos" class="passos"></ol>
    </section>

    <section class="cartao">
      <h2>3. Emitir uma nota</h2>
      <div class="abas" role="group" aria-label="Tipo de nota">
        <button type="button" data-aba="nfce" aria-pressed="true">NFC-e (cupom)</button>
        <button type="button" data-aba="nfe" aria-pressed="false">NF-e (venda)</button>
        <button type="button" data-aba="nfse" aria-pressed="false">NFS-e (serviço)</button>
      </div>

      <div data-form="nfce">
        <div class="grade">
          <div><label for="c_desc">Produto</label><input id="c_desc" value="Produto de teste"></div>
          <div><label for="c_valor">Valor (R$)</label><input id="c_valor" inputmode="decimal" value="1,00"></div>
          <div><label for="c_forma">Pagamento</label><select id="c_forma"><option value="dinheiro">Dinheiro</option><option value="pix">Pix</option><option value="credito">Cartão de crédito</option><option value="debito">Cartão de débito</option></select></div>
          <div><label for="c_cpf">CPF do cliente (opcional)</label><input id="c_cpf" inputmode="numeric"></div>
          <div><label for="c_ncm">NCM</label><input id="c_ncm" value="21069090"></div>
          <div><label for="c_cfop">CFOP</label><input id="c_cfop" value="5102"></div>
        </div>
      </div>

      <div data-form="nfe" class="oculto">
        <div class="grade">
          <div><label for="e_doc">CPF ou CNPJ do cliente</label><input id="e_doc" inputmode="numeric" value="12345678909"></div>
          <div><label for="e_nome">Nome do cliente</label><input id="e_nome" value="Cliente de teste"></div>
          <div><label for="e_ie">IE do cliente (se for contribuinte)</label><input id="e_ie" inputmode="numeric"></div>
          <div><label for="e_rua">Rua</label><input id="e_rua" value="Rua de teste"></div>
          <div><label for="e_num">Número</label><input id="e_num" value="1"></div>
          <div><label for="e_bairro">Bairro</label><input id="e_bairro" value="Centro"></div>
          <div><label for="e_cep">CEP</label><input id="e_cep" inputmode="numeric"></div>
          <div><label for="e_desc">Produto</label><input id="e_desc" value="Produto de teste"></div>
          <div><label for="e_valor">Valor (R$)</label><input id="e_valor" inputmode="decimal" value="1,00"></div>
          <div><label for="e_ncm">NCM</label><input id="e_ncm" value="21069090"></div>
          <div><label for="e_cfop">CFOP</label><input id="e_cfop" value="5102"></div>
          <div><label for="e_forma">Pagamento</label><select id="e_forma"><option value="dinheiro">Dinheiro</option><option value="pix">Pix</option><option value="boleto">Boleto</option><option value="credito">Cartão de crédito</option></select></div>
        </div>
        <p class="suave">O cliente fica na mesma cidade da empresa. CPF 123.456.789-09 é de teste.</p>
      </div>

      <div data-form="nfse" class="oculto">
        <div class="grade">
          <div><label for="s_desc">Descrição do serviço</label><input id="s_desc" value="Servico de teste"></div>
          <div><label for="s_valor">Valor (R$)</label><input id="s_valor" inputmode="decimal" value="1,00"></div>
          <div><label for="s_trib">Código de tributação nacional</label><input id="s_trib" inputmode="numeric" placeholder="ex.: 090201"></div>
          <div><label for="s_nbs">Código NBS</label><input id="s_nbs" inputmode="numeric" placeholder="ex.: 118054000"></div>
          <div><label for="s_doc">CPF/CNPJ do tomador (opcional)</label><input id="s_doc" inputmode="numeric"></div>
          <div><label for="s_nome">Nome do tomador</label><input id="s_nome"></div>
        </div>
        <p class="suave" id="s_padrao"></p>
      </div>

      <p><button id="emitir" class="principal" type="button">Emitir</button> <span id="emitirTexto" class="suave"></span></p>
    </section>

    <section class="cartao">
      <h2>4. Notas do mês <span id="ambLista" class="suave"></span></h2>
      <p><button id="recarregar" type="button">Atualizar lista</button></p>
      <div class="rolagem"><table>
        <thead><tr><th>Nota</th><th>Nº</th><th>Emissão</th><th>Situação</th><th>Valor</th><th>Ações</th></tr></thead>
        <tbody id="notas"></tbody>
      </table></div>
    </section>
  </div>
</main>
<div id="mensagem" role="status"></div>
<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var token = sessionStorage.getItem("fiscal-token") || "";
  var empresas = [];
  var aba = "nfce";
  var NOME = { "65": "NFC-e", "55": "NF-e", nfse: "NFS-e", nfce: "NFC-e", nfe: "NF-e" };
  var ROTA = { "65": "nfce", "55": "nfe", nfse: "nfse" };

  function aviso(t, ms){ var m=$("mensagem"); m.textContent=t; m.style.display="block"; clearTimeout(aviso.t); aviso.t=setTimeout(function(){ m.style.display="none"; }, ms||5000); }
  function el(tag, texto, classe){ var e=document.createElement(tag); if(texto!=null) e.textContent=texto; if(classe) e.className=classe; return e; }
  function botao(texto, fn, classe){ var b=el("button", texto, classe); b.type="button"; b.onclick=fn; return b; }
  function guardar(k, v){ try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k, v); }catch(e){} }
  function lido(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function numero(v){ return Math.round(Number(String(v).replace(/[.]/g,"").replace(",", "."))*100)/100; }
  function digitos(v){ return String(v||"").replace(/[^0-9]/g,""); }
  function moeda(v){ return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); }
  function empresa(){ var id=$("empresa").value; return empresas.filter(function(e){ return e.id===id; })[0]; }
  function ambiente(){ var r=document.querySelector("input[name=amb]:checked"); return r ? Number(r.value) : 2; }

  function mensagemErro(corpo, status){
    var e = corpo && corpo.erro;
    if(!e) return "HTTP " + status;
    var probs = e.detalhes && e.detalhes.problemas;
    return e.mensagem + (probs && probs.length ? " " + probs.join(" ") : "");
  }

  async function admin(metodo, rota, corpo){
    var r = await fetch("/v1/admin" + rota, { method: metodo, headers: Object.assign({ Authorization: "Bearer " + token }, corpo ? { "Content-Type": "application/json" } : {}), body: corpo ? JSON.stringify(corpo) : undefined });
    if(r.status===401){ sair(); throw new Error("Senha do painel inválida."); }
    var dados = r.status===204 ? null : await r.json();
    if(!r.ok) throw new Error(mensagemErro(dados, r.status));
    return dados;
  }

  // Chave de API própria desta tela, por empresa, guardada neste navegador
  async function chave(nova){
    var emp = empresa(); var k = "fiscal-teste-chave-" + emp.id;
    var atual = lido(k);
    if(atual && !nova) return JSON.parse(atual);
    if(atual){ try{ await admin("DELETE", "/empresas/" + emp.id + "/chaves/" + JSON.parse(atual).id); }catch(e){} }
    var gerada = await admin("POST", "/empresas/" + emp.id + "/chaves");
    var v = { id: gerada.id, chave: gerada.chave };
    guardar(k, JSON.stringify(v));
    return v;
  }

  // Chamada à API da empresa. tipo: "json" (padrão) ou "arquivo"
  async function api(metodo, rota, corpo, opcoes){
    opcoes = opcoes || {};
    for(var tentativa=0; tentativa<2; tentativa++){
      var k = await chave(tentativa>0);
      var cab = { Authorization: "Bearer " + k.chave };
      if(ambiente()===2) cab["Fiscal-Ambiente"] = "2";
      if(corpo) cab["Content-Type"] = "application/json";
      if(opcoes.idem) cab["Idempotency-Key"] = opcoes.idem;
      var r = await fetch("/v1" + rota, { method: metodo, headers: cab, body: corpo ? JSON.stringify(corpo) : undefined });
      if(r.status===401 && tentativa===0) continue;
      var tipo = r.headers.get("content-type") || "";
      var dados = tipo.indexOf("json")>=0 ? await r.json() : await r.blob();
      if(!r.ok && !(opcoes.aceitar && opcoes.aceitar.indexOf(r.status)>=0)) throw new Error(mensagemErro(dados, r.status));
      return { status: r.status, dados: dados, tipo: tipo };
    }
  }

  function abrirArquivo(blob, nome){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href=url; a.target="_blank"; a.rel="noopener";
    if(nome) a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
  }

  function mostrarEmpresa(){
    var e = empresa(); if(!e) return;
    var tem = [];
    if(e.nfce) tem.push("NFC-e série " + e.nfce.serie);
    if(e.nfe) tem.push("NF-e série " + e.nfe.serie);
    if(e.nfse) tem.push("NFS-e série " + e.nfse.serie);
    var cert = e.certificado ? "certificado até " + new Date(e.certificado.validoAte).toLocaleDateString("pt-BR") : "SEM certificado";
    $("infoEmpresa").textContent = "CNPJ " + e.cnpj + " · cadastrada em " + (e.ambiente===1 ? "produção" : "homologação") + " · " + cert + " · " + (tem.join(" · ") || "nenhuma nota configurada");
    var prod = document.querySelector("input[name=amb][value='1']");
    prod.disabled = e.ambiente!==1;
    if(e.ambiente!==1) document.querySelector("input[name=amb][value='2']").checked = true;
    var p = e.nfse && e.nfse.servicoPadrao;
    $("s_trib").value = lido("fiscal-teste-trib-" + e.id) || (p && p.codigoTributacaoNacional) || "";
    $("s_nbs").value = lido("fiscal-teste-nbs-" + e.id) || (p && p.codigoNbs) || "";
    $("s_padrao").textContent = p ? "Códigos padrão do cadastro já preenchidos." : "";
    $("e_cep").value = $("e_cep").value || (e.nfe && e.nfe.emitente.endereco.cep) || "";
    document.querySelectorAll("[data-aba]").forEach(function(b){ b.disabled = !e[b.getAttribute("data-aba")]; });
    if(!e[aba]){ var primeira=["nfce","nfe","nfse"].filter(function(t){ return e[t]; })[0]; if(primeira) trocarAba(primeira); }
    mostrarAmbiente();
  }

  function mostrarAmbiente(){
    var teste = ambiente()===2;
    var f = $("faixa");
    f.className = "faixa " + (teste ? "teste" : "producao");
    f.textContent = teste ? "Ambiente de TESTE: as notas não têm valor fiscal. Pode testar à vontade." : "PRODUÇÃO: cada nota emitida vale de verdade e vai para a SEFAZ e a Receita. Cancele as de teste no prazo (NFC-e: 30 min; NF-e: 24 h).";
    $("testarTudo").disabled = !teste;
    $("ambLista").textContent = teste ? "(teste)" : "(produção)";
    carregarNotas();
  }

  function trocarAba(nova){
    aba = nova;
    document.querySelectorAll("[data-aba]").forEach(function(b){ b.setAttribute("aria-pressed", String(b.getAttribute("data-aba")===nova)); });
    document.querySelectorAll("[data-form]").forEach(function(f){ f.classList.toggle("oculto", f.getAttribute("data-form")!==nova); });
  }

  function tributacao(e){
    return e.nfe.emitente.crt===3
      ? { icms: { cst: "00", aliquota: 17 }, pis: { cst: "01", aliquota: 0.65 }, cofins: { cst: "01", aliquota: 3 } }
      : { icms: { csosn: "102" }, pis: { cst: "99" }, cofins: { cst: "99" } };
  }
  function pagamento(forma, valor){
    var p = { forma: forma, valor: valor };
    if(forma==="pix"||forma==="credito"||forma==="debito") p.integrado = false;
    return p;
  }

  function pedidoNfce(){
    var valor = numero($("c_valor").value);
    var venda = { itens: [{ descricao: $("c_desc").value.trim(), ncm: digitos($("c_ncm").value), cfop: digitos($("c_cfop").value), quantidade: 1, valorUnitario: valor }], pagamentos: [pagamento($("c_forma").value, valor)] };
    var cpf = digitos($("c_cpf").value); if(cpf) venda.destinatario = { documento: cpf };
    return { venda: venda, referencia: "tela-de-testes" };
  }
  function pedidoNfe(){
    var e = empresa(); var end = e.nfe.emitente.endereco;
    var valor = numero($("e_valor").value);
    var ie = digitos($("e_ie").value);
    var dest = { documento: digitos($("e_doc").value), nome: $("e_nome").value.trim(), indicadorIe: ie ? 1 : 9,
      endereco: { logradouro: $("e_rua").value.trim(), numero: $("e_num").value.trim(), bairro: $("e_bairro").value.trim(), codigoMunicipio: end.codigoMunicipio, municipio: end.municipio, uf: end.uf, cep: digitos($("e_cep").value) } };
    if(ie) dest.inscricaoEstadual = ie;
    return { operacao: { destinatario: dest, itens: [{ codigo: "TESTE", descricao: $("e_desc").value.trim(), ncm: digitos($("e_ncm").value), cfop: digitos($("e_cfop").value), quantidade: 1, valorUnitario: valor, tributacao: tributacao(e) }], pagamentos: [pagamento($("e_forma").value, valor)] }, nota: { naturezaOperacao: "Venda de mercadoria" }, referencia: "tela-de-testes" };
  }
  function pedidoNfse(){
    var e = empresa();
    guardar("fiscal-teste-trib-" + e.id, digitos($("s_trib").value));
    guardar("fiscal-teste-nbs-" + e.id, digitos($("s_nbs").value));
    var servico = { descricao: $("s_desc").value.trim() };
    if(digitos($("s_trib").value)) servico.codigoTributacaoNacional = digitos($("s_trib").value);
    if(digitos($("s_nbs").value)) servico.codigoNbs = digitos($("s_nbs").value);
    if(!servico.codigoMunicipioPrestacao && !(e.nfse.servicoPadrao && e.nfse.servicoPadrao.codigoMunicipioPrestacao)) servico.codigoMunicipioPrestacao = e.nfce ? e.nfce.emitente.endereco.codigoMunicipio : (e.nfe ? e.nfe.emitente.endereco.codigoMunicipio : undefined);
    // Reforma tributária: no TESTE, sem os códigos do contador no cadastro, usa os genéricos
    // (tributação integral, serviço em geral). Em produção valem só os do cadastro.
    if(ambiente()===2 && !(e.nfse.servicoPadrao && e.nfse.servicoPadrao.ibsCbs)) servico.ibsCbs = { cst: "000", cClassTrib: "000001", cIndOp: "100301" };
    var pedido = { servico: servico, valores: { valorServico: numero($("s_valor").value), tributacaoIssqn: 1, retencaoIss: 1 }, referencia: "tela-de-testes" };
    var doc = digitos($("s_doc").value);
    if(doc) pedido.tomador = { documento: doc, nome: $("s_nome").value.trim() || "Tomador" };
    // No TESTE, sem tomador: um fictício com o endereço da própria empresa (com IBS/CBS o imposto
    // incide no endereço do tomador, e o governo exige o tomador identificado e com endereço)
    var em = (e.nfce && e.nfce.emitente) || (e.nfe && e.nfe.emitente);
    if(!doc && ambiente()===2 && em && em.endereco.cep){
      pedido.tomador = { documento: "12345678909", nome: "Tomador de teste",
        endereco: { codigoMunicipio: em.endereco.codigoMunicipio, cep: em.endereco.cep, logradouro: em.endereco.logradouro, numero: em.endereco.numero || "S/N", bairro: em.endereco.bairro } };
    }
    return pedido;
  }
  var PEDIDO = { nfce: pedidoNfce, nfe: pedidoNfe, nfse: pedidoNfse };

  function idem(){ return "tela-" + Date.now() + "-" + Math.random().toString(36).slice(2,10); }
  function idNota(tipo, d){ return tipo==="nfse" ? (d.chave || d.id) : d.chave; }
  function textoResultado(d){
    var t = (d.situacao || "") + (d.cStat ? " (" + d.cStat + ")" : "") + (d.motivo ? ": " + d.motivo : "");
    if(d.erros && d.erros.length) t += " " + d.erros.map(function(x){ return x.codigo + " " + x.descricao; }).join("; ");
    return t;
  }

  async function emitir(tipo){
    var r = await api("POST", "/" + tipo, PEDIDO[tipo](), { idem: idem(), aceitar: [422] });
    return r.dados;
  }

  $("emitir").onclick = async function(){
    var e = empresa();
    if(ambiente()===1 && !confirm("PRODUÇÃO: esta " + NOME[aba] + " vai valer de verdade. Emitir mesmo?")) return;
    var b = this; b.disabled = true; $("emitirTexto").textContent = "Enviando…";
    try{
      var d = await emitir(aba);
      $("emitirTexto").textContent = NOME[aba] + " nº " + (d.numero || d.numeroDps || "") + ": " + textoResultado(d);
      $("emitirTexto").className = d.situacao==="autorizada" ? "ok" : (d.situacao==="rejeitada"||d.situacao==="denegada" ? "critico" : "aviso");
      carregarNotas();
    }catch(x){ $("emitirTexto").textContent = x.message; $("emitirTexto").className = "critico"; }
    finally{ b.disabled = false; }
  };

  // ---- Teste completo
  function passo(texto){ var li = el("li", texto + "…", "suave"); $("passos").appendChild(li); return li; }
  async function etapa(texto, fn){
    var li = passo(texto);
    try{ var extra = await fn(); li.textContent = "✓ " + texto + (extra ? ": " + extra : ""); li.className = "ok"; return true; }
    catch(x){ li.textContent = "✗ " + texto + ": " + x.message; li.className = "critico"; return false; }
  }

  $("testarTudo").onclick = async function(){
    if(ambiente()!==2) return;
    var e = empresa(); var b = this; b.disabled = true; $("passos").textContent = "";
    var falhas = 0;
    var conta = function(ok){ if(!ok) falhas++; return ok; };
    try{
      if(e.nfce || e.nfe) conta(await etapa("SEFAZ no ar", async function(){ var s=(await api("GET","/sefaz/status")).dados; if(!s.emOperacao) throw new Error(s.xMotivo); return s.xMotivo + ", relógio " + s.diferencaRelogioSegundos + " s"; }));
      for(var i=0;i<3;i++){
        var tipo = ["nfce","nfe","nfse"][i];
        if(!e[tipo]) continue;
        var nota = null;
        var ok = conta(await etapa("Emitir " + NOME[tipo], async function(){
          var d = await emitir(tipo);
          if(d.situacao!=="autorizada") throw new Error(textoResultado(d));
          nota = idNota(tipo, d); return "nº " + (d.numero || d.numeroDps) + " autorizada";
        }));
        if(!ok) continue;
        conta(await etapa("Consultar " + NOME[tipo], async function(){ var d=(await api("GET","/" + tipo + "/" + nota)).dados; if(d.situacao!=="autorizada") throw new Error(d.situacao); return d.situacao; }));
        conta(await etapa("XML da " + NOME[tipo], async function(){ var r=await api("GET","/" + tipo + "/" + nota + "/xml"); return Math.round(r.dados.size/1024*10)/10 + " KB"; }));
        var doc = { nfce: "danfe?formato=html", nfe: "danfe", nfse: "danfse" }[tipo];
        conta(await etapa((tipo==="nfce" ? "Cupom" : "PDF") + " da " + NOME[tipo], async function(){ var r=await api("GET","/" + tipo + "/" + nota + "/" + doc); if(!r.dados.size) throw new Error("vazio"); return Math.round(r.dados.size/1024*10)/10 + " KB"; }));
        if(tipo==="nfe") conta(await etapa("Carta de correção da NF-e", async function(){ var d=(await api("POST","/nfe/" + nota + "/carta-correcao",{ correcao: "Teste de carta de correcao pela tela de testes" })).dados; return d.motivo; }));
        conta(await etapa("Cancelar " + NOME[tipo], async function(){
          var corpo = tipo==="nfse" ? { motivo: "Teste pela tela de testes", codigoMotivo: 1 } : { justificativa: "Teste pela tela de testes sem valor fiscal" };
          var d=(await api("POST","/" + tipo + "/" + nota + "/cancelamento", corpo)).dados;
          if(d.situacao!=="cancelada") throw new Error(d.situacao + " " + (d.motivo||""));
          return "cancelada";
        }));
      }
      var hoje = new Date();
      conta(await etapa("Relatório do contador (PDF)", async function(){ var r=await api("GET","/relatorios/" + hoje.getFullYear() + "/" + (hoje.getMonth()+1) + "?ambiente=2"); return Math.round(r.dados.size/1024*10)/10 + " KB"; }));
      var fim = el("li", falhas ? "Terminou com " + falhas + " problema(s). Veja os itens em vermelho." : "Tudo certo: todas as notas funcionam.", falhas ? "critico" : "ok");
      fim.style.fontWeight = "600"; $("passos").appendChild(fim);
    } finally { b.disabled = false; carregarNotas(); }
  };

  // ---- Lista do mês
  async function carregarNotas(){
    var e = empresa(); if(!e) return;
    var corpo = $("notas"); corpo.textContent = "";
    try{
      var hoje = new Date();
      var r = await api("GET", "/relatorios/" + hoje.getFullYear() + "/" + (hoje.getMonth()+1) + "?formato=json&ambiente=" + ambiente());
      var notas = (r.dados.notas || []).slice().sort(function(a,b){ return String(b.dataEmissao).localeCompare(String(a.dataEmissao)); });
      if(!notas.length){ var tr=el("tr"); var td=el("td","Nenhuma nota neste mês.","suave"); td.colSpan=6; tr.appendChild(td); corpo.appendChild(tr); return; }
      notas.forEach(function(n){
        var tipo = ROTA[n.modelo]; var tr = el("tr");
        tr.appendChild(el("td", NOME[n.modelo] + " · série " + n.serie));
        tr.appendChild(el("td", String(n.numero)));
        tr.appendChild(el("td", new Date(n.dataEmissao).toLocaleString("pt-BR")));
        tr.appendChild(el("td", n.situacao, n.situacao==="autorizada" ? "ok" : (n.situacao==="cancelada" ? "suave" : "aviso")));
        tr.appendChild(el("td", moeda(n.valor)));
        var acoes = el("td");
        if(n.chave){
          acoes.appendChild(botao("Consultar", async function(){ try{ var d=(await api("GET","/" + tipo + "/" + n.chave)).dados; aviso(NOME[n.modelo] + " nº " + n.numero + ": " + d.situacao); carregarNotas(); }catch(x){ aviso(x.message); } }));
          acoes.appendChild(botao("XML", async function(){ try{ abrirArquivo((await api("GET","/" + tipo + "/" + n.chave + "/xml")).dados, n.chave + ".xml"); }catch(x){ aviso(x.message); } }));
          var doc = { nfce: "danfe?formato=html", nfe: "danfe", nfse: "danfse" }[tipo];
          acoes.appendChild(botao(tipo==="nfce" ? "Cupom" : "PDF", async function(){ try{ abrirArquivo((await api("GET","/" + tipo + "/" + n.chave + "/" + doc)).dados); }catch(x){ aviso(x.message); } }));
          if(tipo==="nfe" && n.situacao==="autorizada") acoes.appendChild(botao("Carta de correção", async function(){
            var t = prompt("Texto da correção (mínimo 15 letras):"); if(!t) return;
            try{ var d=(await api("POST","/nfe/" + n.chave + "/carta-correcao",{ correcao: t })).dados; aviso("Carta de correção: " + d.motivo); }catch(x){ aviso(x.message); }
          }));
          if(n.situacao==="autorizada" || n.situacao==="offline") acoes.appendChild(botao("Cancelar", async function(){
            if(ambiente()===1 && !confirm("Cancelar esta nota de PRODUÇÃO?")) return;
            var t = prompt("Motivo do cancelamento (mínimo 15 letras):", "Nota emitida em teste"); if(!t) return;
            var corpo = tipo==="nfse" ? { motivo: t, codigoMotivo: 1 } : { justificativa: t };
            try{ var d=(await api("POST","/" + tipo + "/" + n.chave + "/cancelamento", corpo)).dados; aviso("Cancelamento: " + d.situacao); carregarNotas(); }catch(x){ aviso(x.message); }
          }, "perigo"));
        }
        tr.appendChild(acoes); corpo.appendChild(tr);
      });
    }catch(x){ var tr=el("tr"); var td=el("td", x.message, "critico"); td.colSpan=6; tr.appendChild(td); corpo.appendChild(tr); }
  }

  $("status").onclick = async function(){
    $("statusTexto").textContent = "Consultando…";
    try{ var s=(await api("GET","/sefaz/status")).dados; $("statusTexto").textContent = (s.emOperacao ? "No ar" : "FORA") + " · " + s.xMotivo + " · diferença do relógio " + s.diferencaRelogioSegundos + " s"; $("statusTexto").className = s.emOperacao ? "ok" : "critico"; }
    catch(x){ $("statusTexto").textContent = x.message; $("statusTexto").className = "critico"; }
  };
  $("recarregar").onclick = carregarNotas;
  $("empresa").onchange = mostrarEmpresa;
  document.querySelectorAll("input[name=amb]").forEach(function(r){ r.onchange = mostrarAmbiente; });
  document.querySelectorAll("[data-aba]").forEach(function(b){ b.onclick = function(){ trocarAba(b.getAttribute("data-aba")); }; });

  function sair(){ token=""; sessionStorage.removeItem("fiscal-token"); $("app").classList.add("oculto"); $("entrar").classList.remove("oculto"); $("sair").classList.add("oculto"); }
  $("sair").onclick = sair;
  async function iniciar(){
    empresas = await admin("GET", "/empresas");
    var sel = $("empresa"); sel.textContent = "";
    empresas.forEach(function(e){ var o=el("option", e.nome + " (" + e.id + ")"); o.value=e.id; sel.appendChild(o); });
    if(!empresas.length) throw new Error("Nenhuma empresa cadastrada. Cadastre no Painel.");
    $("entrar").classList.add("oculto"); $("app").classList.remove("oculto"); $("sair").classList.remove("oculto");
    mostrarEmpresa();
  }
  $("botaoEntrar").onclick = async function(){ token=$("token").value.trim(); try{ await iniciar(); sessionStorage.setItem("fiscal-token", token); }catch(x){ aviso(x.message); } };
  $("token").onkeydown = function(ev){ if(ev.key==="Enter") $("botaoEntrar").click(); };
  if(token) iniciar().catch(function(x){ aviso(x.message); });
})();
</script>
</body>
</html>`;
