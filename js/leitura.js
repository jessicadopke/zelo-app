// Zelo: leitura de comprovante (#73), parte do aparelho que não desenha nada.
// Confere o arquivo, reduz a foto, monta o pedido da ação ler_comprovante e entende a resposta (contrato, seção 3A).
// PRIVACIDADE: o arquivo só existe em variável de memória. Nada daqui usa IndexedDB, localStorage, sessionStorage, Cache,
// a fila de envio, histórico ou endereço; nada vai para o console. Quem chama solta as variáveis ao sair da tela.
// Só dados fictícios nos testes. No navegador vira o objeto global Leitura.
var Leitura = (function () {
  var TIPOS = ["image/jpeg", "image/png", "application/pdf"];
  var MAX_ARQUIVOS = 5;
  var MAX_BASE64_ARQUIVO = 4000000; // caracteres de base64 por arquivo (o que o script mede)
  var MAX_BASE64_SOMA = 6000000;
  var LADO_MAIOR = 1600; // px
  var QUALIDADE = 0.8;
  var MAX_BYTES_ARQUIVO = 3000000; // foto reduzida ou PDF: até 3 MB cada
  var MAX_BYTES_ORIGINAL_IMAGEM = 40000000; // foto de câmera é grande; acima disto nem tenta abrir
  var TEMPO_LIMITE = 60000; // ms que o app espera pela leitura
  var AVISO_DEMORA = 20000; // ms até dizer que está demorando
  var DUVIDAS = ["data", "valor_centavos", "tipo", "favorecido", "categoria", "cartao"];

  var MENSAGENS = {
    tamanho: "Arquivo grande demais; mande foto das páginas.",
    soma: "Os arquivos juntos ficaram grandes demais; mande menos páginas ou foto das páginas.",
    tipo: "Não consigo ler este tipo de arquivo. Use uma foto (JPG ou PNG) ou um PDF.",
    preparo: "Não consegui preparar esta foto. Tire outra."
  };

  // Quantos caracteres de base64 ocupam estes bytes.
  function tamanhoBase64(bytes) {
    return 4 * Math.ceil(Math.max(0, bytes) / 3);
  }

  // Tamanho depois de reduzir: o lado maior vira, no máximo, `lado`; nunca aumenta. Inteiros de pelo menos 1 px.
  function tamanhoReduzido(largura, altura, lado) {
    var max = typeof lado === "number" && lado > 0 ? lado : LADO_MAIOR;
    var maior = Math.max(largura, altura);
    if (!(maior > max)) return { largura: Math.max(1, Math.round(largura)), altura: Math.max(1, Math.round(altura)) };
    var f = max / maior;
    return { largura: Math.max(1, Math.round(largura * f)), altura: Math.max(1, Math.round(altura * f)) };
  }

  // arquivo: { type, size } (um File). Imagem pode ser grande (vai ser reduzida); PDF vai como está, então o limite vale já.
  function conferirArquivo(arquivo) {
    var a = arquivo || {};
    if (TIPOS.indexOf(a.type) < 0) return { ok: false, motivo: "tipo", mensagem: MENSAGENS.tipo };
    var bytes = typeof a.size === "number" ? a.size : 0;
    if (a.type === "application/pdf") {
      if (tamanhoBase64(bytes) > MAX_BASE64_ARQUIVO || bytes > MAX_BYTES_ARQUIVO) return { ok: false, motivo: "tamanho", mensagem: MENSAGENS.tamanho };
    } else if (bytes > MAX_BYTES_ORIGINAL_IMAGEM) {
      return { ok: false, motivo: "tamanho", mensagem: MENSAGENS.tamanho };
    }
    return { ok: true };
  }

  // lista: [{ tipo_arquivo, base64 }] já prontos para enviar.
  function conferirLote(lista) {
    if (!Array.isArray(lista) || lista.length < 1) return { ok: false, motivo: "vazio", mensagem: "Escolha pelo menos uma foto ou um PDF." };
    if (lista.length > MAX_ARQUIVOS) return { ok: false, motivo: "quantidade", mensagem: "Pode mandar até " + MAX_ARQUIVOS + " páginas." };
    var soma = 0;
    for (var i = 0; i < lista.length; i++) {
      var x = lista[i];
      if (!x || TIPOS.indexOf(x.tipo_arquivo) < 0 || typeof x.base64 !== "string" || x.base64 === "") return { ok: false, motivo: "tipo", mensagem: MENSAGENS.tipo };
      if (x.base64.length > MAX_BASE64_ARQUIVO) return { ok: false, motivo: "tamanho", mensagem: MENSAGENS.tamanho };
      soma += x.base64.length;
    }
    if (soma > MAX_BASE64_SOMA) return { ok: false, motivo: "soma", mensagem: MENSAGENS.soma };
    return { ok: true };
  }

  // O que vai no corpo do pedido: só os dois campos de cada arquivo e a data de hoje. Mais nada.
  function montarDados(arquivos, hoje) {
    return {
      arquivos: arquivos.map(function (a) { return { tipo_arquivo: a.tipo_arquivo, base64: a.base64 }; }),
      hoje: hoje
    };
  }

  // "1,2 MB" (uma casa, vírgula; nunca menos que 0,1).
  function rotuloTamanho(bytes) {
    var mb = Math.max(0.1, Math.round(bytes / 100000) / 10);
    return String(mb.toFixed(1)).replace(".", ",") + " MB";
  }

  // ---- resposta da ponte ----
  function textoCurto(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }

  function linhaLimpa(l) {
    if (!l || typeof l !== "object") return null;
    var v = l.valor_centavos;
    var valido = typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000000000;
    var tipo = l.tipo === "saiu" || l.tipo === "entrou" || l.tipo === "fatura" ? l.tipo : "";
    var duvidas = Array.isArray(l.duvidas) ? l.duvidas.filter(function (d, i, todas) { return DUVIDAS.indexOf(d) >= 0 && todas.indexOf(d) === i; }) : [];
    var data = typeof l.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.data) ? l.data : "";
    var linha = {
      data: data,
      valor_centavos: valido ? v : null,
      tipo: tipo,
      favorecido: textoCurto(l.favorecido, 80),
      categoria: textoCurto(l.categoria, 40),
      forma: textoCurto(l.forma, 30),
      sugestao: l.sugestao === "ignorar" ? "ignorar" : "lancar",
      motivo: textoCurto(l.motivo, 40),
      duvidas: duvidas
    };
    // O que veio vazio entra em dúvida mesmo se o script esqueceu de listar (segurança: Salvar nunca liga com campo vazio).
    if (!linha.data && duvidas.indexOf("data") < 0) linha.duvidas.push("data");
    if (linha.valor_centavos === null && duvidas.indexOf("valor_centavos") < 0) linha.duvidas.push("valor_centavos");
    if (!linha.tipo && duvidas.indexOf("tipo") < 0) linha.duvidas.push("tipo");
    if (!linha.favorecido && linha.tipo !== "fatura" && duvidas.indexOf("favorecido") < 0) linha.duvidas.push("favorecido");
    if (linha.tipo === "fatura" && duvidas.indexOf("cartao") < 0) linha.duvidas.push("cartao");
    return linha;
  }

  // Resposta de ponte.chamar("ler_comprovante", ...) -> { ok: true, documento, linhas, cortado, uso } ou { ok: false, caso, mensagem? }.
  // caso: semnet | demora | teto | invalida | tamanho | config | codigo | vazio (leu, mas sem linhas).
  function entenderResposta(resp) {
    if (!resp || typeof resp !== "object") return { ok: false, caso: "demora" };
    if (resp.ok === true) {
      var d = resp.dados;
      if (!d || typeof d !== "object" || !Array.isArray(d.linhas)) return { ok: false, caso: "invalida" };
      var linhas = d.linhas.map(linhaLimpa).filter(function (x) { return x !== null; });
      if (linhas.length !== d.linhas.length) return { ok: false, caso: "invalida" };
      if (linhas.length === 0) return { ok: false, caso: "vazio" };
      var doc = d.documento === "extrato" || d.documento === "outro" ? d.documento : "comprovante";
      return { ok: true, documento: doc, linhas: linhas, cortado: d.cortado === true, uso: d.uso && typeof d.uso === "object" ? d.uso : null };
    }
    var erro = resp.erro && typeof resp.erro === "object" ? resp.erro : {};
    var cod = erro.codigo;
    if (cod === "sem_internet") return { ok: false, caso: "semnet" };
    if (cod === "tempo_esgotado") return { ok: false, caso: "demora" };
    if (cod === "teto_atingido") return { ok: false, caso: "teto" };
    if (cod === "modelo_indisponivel" && erro.detalhe === "leitura_invalida") return { ok: false, caso: "invalida" };
    if (cod === "sem_configuracao" || cod === "endereco_invalido") return { ok: false, caso: "config", mensagem: typeof erro.mensagem === "string" ? erro.mensagem : "" };
    if (cod === "codigo_invalido") return { ok: false, caso: "codigo", mensagem: typeof erro.mensagem === "string" ? erro.mensagem : "" };
    if (cod === "dado_invalido" && (erro.detalhe === "tamanho" || erro.detalhe === "base64")) return { ok: false, caso: "tamanho" };
    return { ok: false, caso: "demora" }; // modelo_indisponivel, ocupado, interno, resposta_estranha: "tente de novo"
  }

  // ---- navegador: reduzir a foto e virar base64 (o desenho no canvas é teste no celular) ----
  function paraBase64(blob, deps) {
    var LeitorArquivo = (deps && deps.FileReader) || (typeof FileReader !== "undefined" ? FileReader : null);
    return new Promise(function (resolve, reject) {
      if (!LeitorArquivo) { reject(new Error("sem leitor")); return; }
      var r = new LeitorArquivo();
      r.onload = function () {
        var s = typeof r.result === "string" ? r.result : "";
        var i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : "");
      };
      r.onerror = function () { reject(new Error("falha ao ler")); };
      r.readAsDataURL(blob);
    });
  }

  // Devolve um Blob JPEG com o lado maior em `lado` px. Respeita a rotação da foto (EXIF) com imageOrientation.
  function reduzirImagem(file, lado, qualidade, deps) {
    var d = deps || {};
    var criarBitmap = d.createImageBitmap || (typeof createImageBitmap !== "undefined" ? createImageBitmap : null);
    var doc = d.document || (typeof document !== "undefined" ? document : null);
    if (!criarBitmap || !doc) return Promise.reject(new Error("sem canvas"));
    return criarBitmap(file, { imageOrientation: "from-image" }).then(function (img) {
      var t = tamanhoReduzido(img.width, img.height, lado);
      var tela = doc.createElement("canvas");
      tela.width = t.largura;
      tela.height = t.altura;
      var ctx = tela.getContext("2d");
      ctx.fillStyle = "#fff"; // PNG com fundo transparente vira branco no JPEG
      ctx.fillRect(0, 0, t.largura, t.altura);
      ctx.drawImage(img, 0, 0, t.largura, t.altura);
      if (typeof img.close === "function") img.close();
      return new Promise(function (resolve, reject) {
        tela.toBlob(function (b) { if (b) resolve(b); else reject(new Error("sem imagem")); }, "image/jpeg", qualidade);
      });
    });
  }

  // File -> { ok: true, arquivo: { tipo_arquivo, base64, bytes, foto } } ou { ok: false, motivo, mensagem }. Nunca lança.
  // Foto: lado maior 1.600 px, JPEG 0,8; se passar de 3 MB tenta 0,6 e depois 1.200 px. PDF vai como está.
  // deps (testes): { reduzir(file, lado, qualidade), paraBase64(blob) }.
  function prepararArquivo(file, deps) {
    var d = deps || {};
    var reduzir = d.reduzir || function (f, lado, q) { return reduzirImagem(f, lado, q, d); };
    var base64De = d.paraBase64 || function (b) { return paraBase64(b, d); };
    var c = conferirArquivo(file);
    if (!c.ok) return Promise.resolve(c);
    var falha = { ok: false, motivo: "preparo", mensagem: MENSAGENS.preparo };
    if (file.type === "application/pdf") {
      return base64De(file).then(function (b64) {
        var l = conferirLote([{ tipo_arquivo: file.type, base64: b64 }]);
        if (!l.ok) return l;
        return { ok: true, arquivo: { tipo_arquivo: file.type, base64: b64, bytes: file.size, foto: false } };
      }).catch(function () { return { ok: false, motivo: "preparo", mensagem: MENSAGENS.tamanho }; });
    }
    var tentativas = [[LADO_MAIOR, QUALIDADE], [LADO_MAIOR, 0.6], [1200, 0.6]];
    function tentar(i) {
      return reduzir(file, tentativas[i][0], tentativas[i][1]).then(function (blob) {
        if (blob.size > MAX_BYTES_ARQUIVO && i + 1 < tentativas.length) return tentar(i + 1);
        if (blob.size > MAX_BYTES_ARQUIVO) return { ok: false, motivo: "tamanho", mensagem: MENSAGENS.tamanho };
        return base64De(blob).then(function (b64) {
          return { ok: true, arquivo: { tipo_arquivo: "image/jpeg", base64: b64, bytes: blob.size, foto: true } };
        });
      });
    }
    return tentar(0).catch(function () { return falha; });
  }

  return {
    TIPOS: TIPOS, MAX_ARQUIVOS: MAX_ARQUIVOS, MAX_BASE64_ARQUIVO: MAX_BASE64_ARQUIVO, MAX_BASE64_SOMA: MAX_BASE64_SOMA,
    LADO_MAIOR: LADO_MAIOR, QUALIDADE: QUALIDADE, TEMPO_LIMITE: TEMPO_LIMITE, AVISO_DEMORA: AVISO_DEMORA, MENSAGENS: MENSAGENS,
    tamanhoBase64: tamanhoBase64, tamanhoReduzido: tamanhoReduzido, conferirArquivo: conferirArquivo, conferirLote: conferirLote,
    montarDados: montarDados, rotuloTamanho: rotuloTamanho, entenderResposta: entenderResposta, prepararArquivo: prepararArquivo,
    reduzirImagem: reduzirImagem, paraBase64: paraBase64
  };
})();
if (typeof module !== "undefined") module.exports = Leitura;
