// Zelo: lógica das telas de ver (#19, parte A): Lançamentos, Início e Resumo. Decide o que mostrar; quem desenha é js/tela-ver.js.
// Puro: sem DOM, sem banco, sem rede, sem relógio solto, sem console. Não altera o que recebe. No navegador vira o objeto global Ver.
var Ver = (function () {
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");
  var Som = typeof Somas !== "undefined" ? Somas : require("./somas.js");

  var TAMANHO = 50;
  var MENOS = "−"; // sinal de menos de verdade (U+2212)
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  // Valor especial dos filtros: "sem categoria" / "sem pessoa". Não é texto, para não colidir com uma categoria de nome igual.
  var SEM = Object.freeze({ sem: true });
  // Valor especial do filtro "Cartão": só os pagamentos de fatura (de qualquer cartão).
  var FATURAS = Object.freeze({ faturas: true });

  function aparar(v) { return typeof v === "string" ? v.replace(/^\s+|\s+$/g, "") : ""; }
  function plural(n, um, varios) { return n === 1 ? um : varios; }
  function milhar(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }

  // ---- filtros ----
  function casa(valorDoFiltro, campo) {
    if (valorDoFiltro === undefined || valorDoFiltro === null) return true;
    if (valorDoFiltro === SEM) return aparar(campo) === "";
    if (typeof valorDoFiltro !== "string") return true;
    var f = aparar(valorDoFiltro);
    if (f === "") return true;
    return aparar(campo) === f;
  }
  function filtrar(lista, filtros) {
    var f = filtros || {};
    return lista.filter(function (l) { return casa(f.categoria, l.categoria) && casa(f.pessoa, l.pessoa) && casaCartao(f.cartao, l); });
  }
  // Cartão: SEM = fora do cartão; FATURAS = só tipo fatura; texto = compras, estornos e pagamentos desse cartão.
  function casaCartao(valorDoFiltro, l) {
    if (valorDoFiltro === FATURAS) return l.tipo === "fatura";
    return casa(valorDoFiltro, l.cartao);
  }

  function opcoesDe(lista, campo, rotuloSem) {
    var contagem = Object.create(null), nomes = [], sem = 0;
    lista.forEach(function (l) {
      var v = aparar(l[campo]);
      if (v === "") { sem++; return; }
      if (contagem[v] === undefined) { contagem[v] = 0; nomes.push(v); }
      contagem[v]++;
    });
    nomes.sort(function (a, b) { return a.localeCompare(b, "pt-BR") || (a < b ? -1 : a > b ? 1 : 0); });
    var ops = nomes.map(function (n) { return { valor: n, rotulo: n, quantidade: contagem[n] }; });
    if (sem) ops.push({ valor: SEM, rotulo: rotuloSem, quantidade: sem });
    return ops;
  }
  function opcoesDeFiltro(lista) {
    return { categorias: opcoesDe(lista, "categoria", "Sem categoria"), pessoas: opcoesDe(lista, "pessoa", "Sem pessoa") };
  }

  // Opções do filtro "Cartão" (#37, P4): "Fora do cartão", um por cartão e "Só pagamentos de fatura", cada um só com n >= 1.
  // mostrar: há cartão na Config (cartoesConfig) ou nos lançamentos da lista. Sem cartão nenhum, o filtro nem aparece.
  function opcoesDeCartao(lista, cartoesConfig) {
    var por = opcoesDe(lista, "cartao", "Fora do cartão");
    var ops = por.filter(function (o) { return o.valor !== SEM; });
    var fora = por.filter(function (o) { return o.valor === SEM; });
    var faturas = lista.filter(function (l) { return l.tipo === "fatura"; }).length;
    var todas = fora.concat(ops);
    if (faturas) todas.push({ valor: FATURAS, rotulo: "Só pagamentos de fatura", quantidade: faturas });
    var daConfig = Array.isArray(cartoesConfig) && cartoesConfig.length > 0;
    return { mostrar: daConfig || ops.length > 0, opcoes: todas };
  }
  function temFatura(lista) {
    return lista.some(function (l) { return l && l.tipo === "fatura"; });
  }
  // Nota sob os totais de Lançamentos (#39 P5). Só fatura: o texto antigo; qualquer guardou/tirou/saldo: o texto único; senão "".
  function notaDeMovimentos(lista) {
    var outros = lista.some(function (l) { return l && (l.tipo === "guardou" || l.tipo === "tirou" || l.tipo === "saldo"); });
    if (outros) return "Fatura, guardar, tirar e saldo conferido aparecem na lista, mas não contam como gasto nem como renda.";
    return temFatura(lista) ? "Pagamento de fatura aparece na lista, mas não conta como gasto." : "";
  }

  // ---- totais: toda conta de dinheiro é do Somas ----
  function totais(lista, mes) {
    var r = Som.resumoDoMes(lista, mes);
    return { entrou: r.entrou, saiu: r.saiu, saldo: r.saldo, quantidade: r.quantidade, ignorados: r.ignorados };
  }

  // ---- paginação ----
  function paginar(lista, ate, tamanho) {
    var t = tamanho > 0 ? tamanho : TAMANHO;
    var n = ate > 0 ? Math.floor(ate) : t;
    var itens = lista.slice(0, n);
    return { itens: itens, total: lista.length, falta: lista.length - itens.length };
  }
  function maisUm(ate, tamanho) {
    var t = tamanho > 0 ? tamanho : TAMANHO;
    return (ate > 0 ? ate : t) + t;
  }

  // ---- dinheiro escrito (sinal + palavra; zero nunca leva sinal) ----
  function formatar(c) {
    return typeof c === "number" && Number.isInteger(c) ? Din.formatar(Math.abs(c)) : "—";
  }
  // tipo: "entrou" | "saiu" | "saldo". Entrou "+R$ 10,00"; saiu "−R$ 10,00"; saldo com o sinal do próprio número; zero "R$ 0,00".
  function dinheiro(tipo, centavos) {
    if (typeof centavos !== "number" || !Number.isInteger(centavos)) return "—";
    if (centavos === 0) return formatar(0);
    if (tipo === "entrou") return "+" + formatar(centavos);
    if (tipo === "saiu") return MENOS + formatar(centavos);
    return (centavos < 0 ? MENOS : "+") + formatar(centavos);
  }
  // Saldo: { sinal: "pos" | "neg" | "zero", palavra: "Sobrou" | "Faltou" | "Zerado", valor }
  function saldo(centavos) {
    var sinal = centavos < 0 ? "neg" : centavos > 0 ? "pos" : "zero";
    return { sinal: sinal, palavra: sinal === "neg" ? "Faltou" : sinal === "pos" ? "Sobrou" : "Zerado", valor: dinheiro("saldo", centavos) };
  }

  // ---- uma linha da lista (sem HTML) ----
  // Palavra de cada tipo (nunca "Entrou"/"Saiu" para movimentos). Tipo desconhecido segue como "Saiu", como antes.
  var PALAVRAS = { entrou: "Entrou", saiu: "Saiu", fatura: "Fatura", guardou: "Guardou", tirou: "Tirou", saldo: "Saldo conferido" };
  function linha(l) {
    var movimento = l.tipo === "fatura" || l.tipo === "guardou" || l.tipo === "tirou" || l.tipo === "saldo";
    var entrou = l.tipo === "entrou";
    var estado = l.situacao === "esperando" ? "esperando" : l.situacao === "nao_enviado" ? "nao_enviado" : "enviado";
    var fav = aparar(l.favorecido), cat = aparar(l.categoria), pes = aparar(l.pessoa);
    var o = {
      id: l.id,
      titulo: fav || "Sem nome",
      categoria: cat || "Sem categoria",
      pessoa: pes || "Sem pessoa",
      valor: Din.valido(l.valor_centavos) || (l.tipo === "saldo" && l.valor_centavos === 0) ? Din.formatar(l.valor_centavos) : "—",
      sinal: movimento ? "" : entrou ? "+" : MENOS, // movimento: sinal neutro
      tipo: movimento ? l.tipo : entrou ? "entrou" : "saiu",
      palavra: movimento ? PALAVRAS[l.tipo] : entrou ? PALAVRAS.entrou : PALAVRAS.saiu,
      estado: estado,
    };
    // Onde o dinheiro foi: nome do cartão ou da caixinha (também numa compra no cartão).
    var lugar = aparar(l.cartao) || aparar(l.caixinha);
    if (lugar) o.lugar = lugar;
    if (aparar(l.cartao)) o.cartao = aparar(l.cartao);
    if (movimento) o.categoria = lugar || o.categoria;
    if (estado === "nao_enviado") o.motivo = typeof l.motivo_recusa === "string" ? l.motivo_recusa : "";
    return o;
  }

  // Agrupa linhas seguidas do mesmo dia: [{ data, itens: [lancamento] }]. A ordem é a da lista recebida.
  function porDia(lista) {
    var grupos = [];
    lista.forEach(function (l) {
      var ult = grupos[grupos.length - 1];
      if (ult && ult.data === l.data) ult.itens.push(l);
      else grupos.push({ data: l.data, itens: [l] });
    });
    return grupos;
  }

  // ---- meses ----
  function mesDe(data) { return Dat.valida(data) ? Dat.mes(data) : null; }
  function mesesDisponiveis(lista, hoje) {
    var mHoje = mesDe(hoje) || (typeof hoje === "string" && /^\d{4}-\d{2}$/.test(hoje) ? hoje : null);
    var menor = null, maior = null;
    lista.forEach(function (l) {
      var m = mesDe(l && l.data);
      if (!m) return;
      if (menor === null || m < menor) menor = m;
      if (maior === null || m > maior) maior = m;
    });
    return { primeiro: menor || mHoje, ultimo: maior !== null && mHoje !== null && maior > mHoje ? maior : (mHoje || maior) };
  }
  // passo -1 (anterior) ou +1 (seguinte). Fora dos limites devolve null.
  function vizinho(mes, passo, limites) {
    var alvo = passo < 0 ? Dat.mesAnterior(mes) : Dat.mesSeguinte(mes);
    var l = limites || {};
    if (l.primeiro && alvo < l.primeiro) return null;
    if (l.ultimo && alvo > l.ultimo) return null;
    return alvo;
  }
  function nomeDoMes(mes) {
    var m = /^(\d{4})-(\d{2})$/.exec(typeof mes === "string" ? mes : "");
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return "";
    return MESES[Number(m[2]) - 1] + " de " + m[1];
  }

  // ---- textos de contagem ----
  function contagem(n) { return milhar(n) + " " + plural(n, "lançamento", "lançamentos"); }
  function mostrando(desenhadas, total) { return "Mostrando " + milhar(desenhadas) + " de " + milhar(total); }
  function maisRotulo(falta, tamanho) { return "Mostrar mais " + Math.min(tamanho > 0 ? tamanho : TAMANHO, falta); }

  // Linha de pendentes do Início: { esperando, nao_enviado, texto } (texto vazio = nada a mostrar).
  function pendentes(lista) {
    var esp = 0, nao = 0;
    lista.forEach(function (l) {
      if (l.situacao === "esperando") esp++;
      else if (l.situacao === "nao_enviado") nao++;
    });
    var partes = [];
    if (esp) partes.push(esp + " esperando envio");
    if (nao) partes.push(nao + plural(nao, " não enviado", " não enviados"));
    return { esperando: esp, nao_enviado: nao, texto: partes.join(" · ") };
  }

  // "10:32" a partir de milissegundos (hora local do celular); sem valor: "Ainda não atualizou".
  function atualizadoEm(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) return "Ainda não atualizou";
    var d = new Date(ms);
    var dois = function (n) { return (n < 10 ? "0" : "") + n; };
    return "Atualizado às " + dois(d.getHours()) + ":" + dois(d.getMinutes());
  }

  // ---- cartão de lista vazia ----
  // ctx = { mes, total, filtrado, sincronizou, configurado, online, tentou }. Devolve { tipo, titulo, apoio, icone, status, acao }.
  // tentou: já houve uma rodada de sincronização que terminou sem sucesso (não fica "buscando" para sempre).
  function vazio(ctx) {
    var c = ctx || {};
    var nome = nomeDoMes(c.mes);
    if (c.filtrado && c.total > 0) {
      return { tipo: "filtro", titulo: "Nenhum lançamento com este filtro", apoio: "Tire um filtro para ver os outros lançamentos de " + nome + ".", icone: "i-vazio", status: true, acao: "limpar" };
    }
    if (!c.sincronizou && !(c.total > 0)) {
      if (!c.configurado) {
        return { tipo: "semconfig", titulo: "Os lançamentos da planilha aparecem depois de ligar o Zelo à planilha.", apoio: "Falta configurar a ligação em Ajustes.", icone: "i-info", status: true, acao: "ajustes" };
      }
      if (!c.online || c.tentou) {
        return { tipo: "semnet", titulo: "Os lançamentos da planilha aparecem depois da primeira conexão.", apoio: "Você já pode anotar gastos. Eles ficam guardados neste celular.", icone: "i-semnet", status: true, acao: null };
      }
      return { tipo: "buscando", titulo: "Buscando seus lançamentos na planilha…", apoio: "Na primeira vez pode levar alguns segundos. Você já pode anotar gastos.", icone: "i-enviando", status: true, acao: null };
    }
    return { tipo: "mes", titulo: "Nenhum lançamento em " + nome, apoio: "Quando você anotar um gasto ou uma entrada deste mês, ele aparece aqui.", icone: "i-vazio", status: true, acao: "novo" };
  }

  // ---- bloco "Cartões" (Início e Resumo, #37 P4): em aberto de cada cartão até uma data ----
  // Os nomes vêm dos lançamentos e da Config (cartão da Config sem lançamento vale R$ 0,00). Só cartão da Config tem botão "Paguei a fatura".
  // Palavra e valor sem sinal: o sentido está na palavra (Em aberto, Nada em aberto, Pago a mais); nunca "Saiu".
  function estadoDoAberto(centavos) {
    if (centavos > 0) return { tipo: "aberto", palavra: "Em aberto", valor: Din.formatar(centavos) };
    if (centavos === 0) return { tipo: "zerado", palavra: "Nada em aberto", valor: Din.formatar(0) };
    return { tipo: "pago_a_mais", palavra: "Pago a mais", valor: Din.formatar(-centavos), frase: "Você pagou " + Din.formatar(-centavos) + " além das compras lançadas." };
  }
  function cartoes(lancamentos, ate, cartoesConfig) {
    var s = Som.saldos(lancamentos, ate);
    var config = Array.isArray(cartoesConfig) ? cartoesConfig : [];
    var porNome = Object.create(null), nomes = [];
    s.cartoes.forEach(function (c) { porNome[c.cartao] = c.em_aberto; nomes.push(c.cartao); });
    config.forEach(function (n) { if (porNome[n] === undefined) { porNome[n] = 0; nomes.push(n); } });
    nomes.sort(function (a, b) { return a.localeCompare(b, "pt-BR") || (a < b ? -1 : a > b ? 1 : 0); });
    var linhas = nomes.map(function (n) {
      var e = estadoDoAberto(porNome[n]);
      e.cartao = n;
      e.em_aberto = porNome[n];
      e.botao = e.tipo === "aberto" && config.indexOf(n) >= 0;
      return e;
    });
    var total = null;
    if (linhas.length >= 2) { total = estadoDoAberto(s.em_aberto); total.em_aberto = s.em_aberto; }
    return { linhas: linhas, total: total };
  }

  // ---- bloco "Conta" do Resumo (#72): só texto; os números vêm de Somas.contaNoMes (c) ----
  // Sem saldo conferido antes do mês (c.inicio null) não há número nenhum. Mês corrente: segunda linha "Hoje".
  function valorDaConta(centavos) {
    var estado = centavos < 0 ? "negativa" : centavos === 0 ? "zerada" : "na_conta";
    return { estado: estado, palavra: estado === "negativa" ? "Negativa" : estado === "zerada" ? "Zerada" : "Na conta", valor: (centavos < 0 ? MENOS : "") + formatar(Math.abs(centavos)) };
  }
  function conta(c, comLancamentos, hoje) {
    if (!c || typeof c.inicio !== "number") return { tem: false, frase: "Aparece depois de conferir o saldo da conta numa data antes deste mês." };
    var corrente = Dat.mes(hoje) === c.mes;
    var fim = typeof c.fim === "number" ? c.fim : c.inicio;
    var ini = Dat.dosDoMes(Dat.mesAnterior(c.mes)).ate;
    var o = {
      tem: true,
      apoio: corrente ? "O que tinha na conta quando o mês começou e como está hoje." : "O que tinha na conta quando o mês começou e quando terminou.",
      linhas: [
        Object.assign({ rotulo: "Começou com", sub: "Em " + Dat.paraTela(ini) }, valorDaConta(c.inicio)),
        Object.assign({ rotulo: corrente ? "Hoje" : "Terminou com", sub: "Em " + Dat.paraTela(c.ate_fim) }, valorDaConta(fim))
      ],
      aviso: c.acerto && c.conferida_fim ? "Inclui saldo conferido em " + Dat.paraTela(c.conferida_fim).slice(0, 5) : "",
      soma: comLancamentos ? "“Começou com” mais “Saldo do mês” nem sempre dá “Terminou com”. Compra no cartão, fatura, caixinha e saldo conferido mexem na conta de outro jeito." : ""
    };
    return o;
  }

  return {
    conta: conta, reais: formatar, FATURAS: FATURAS, opcoesDeCartao: opcoesDeCartao, temFatura: temFatura, notaDeMovimentos: notaDeMovimentos, cartoes: cartoes, SEM: SEM, TAMANHO: TAMANHO, filtrar: filtrar, opcoesDeFiltro: opcoesDeFiltro, totais: totais, paginar: paginar, maisUm: maisUm,
    dinheiro: dinheiro, saldo: saldo, linha: linha, porDia: porDia, mesesDisponiveis: mesesDisponiveis, vizinho: vizinho, nomeDoMes: nomeDoMes,
    contagem: contagem, mostrando: mostrando, maisRotulo: maisRotulo, pendentes: pendentes, atualizadoEm: atualizadoEm, vazio: vazio,
  };
})();
if (typeof module !== "undefined") module.exports = Ver;
