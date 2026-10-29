// Zelo: banco local no celular (IndexedDB "zelo", versão 1). Só guarda; as regras da fila são de js/fila.js.
// Nada de DOM nem de rede. No navegador vira o objeto global Db; a "fábrica" é o indexedDB (nos testes, um falso em memória).
// Atenção: url_ponte e codigo_aparelho (loja config) são dados do aparelho: nunca vão para arquivo versionado nem para teste com valor real.
var Db = (function () {
  var NOME = "zelo";
  var VERSAO = 1;

  var CAMPOS_REGISTRO = ["id", "data", "tipo", "valor_centavos", "favorecido", "categoria", "pessoa", "forma", "origem", "apagado", "editado_em"];
  var CAMPOS_LANCAMENTO = CAMPOS_REGISTRO.concat(["atualizado_em", "situacao", "motivo_recusa"]);
  var CAMPOS_FILA = ["seq", "id", "registro", "entrou_em"];
  var CHAVES_CONFIG = ["proximo_desde", "url_ponte", "codigo_aparelho", "ultimo_envio_em"];

  var MENSAGENS = {
    sem_espaco: "Não consegui guardar no celular. Falta espaço.",
    indisponivel: "O armazenamento do celular não está disponível agora. Feche outras abas do Zelo e tente de novo.",
    outro: "Não consegui guardar no celular. Tente de novo.",
    campo_nao_permitido: "Este dado não pode ser guardado no celular.",
  };

  function erro(codigo, extra) {
    var e = new Error(MENSAGENS[codigo] || MENSAGENS.outro);
    e.codigo = codigo;
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  // Erro cru do navegador -> Error em português com codigo.
  function traduzir(e) {
    if (e && e.codigo) return e;
    var nome = e && e.name;
    var codigo = "outro";
    if (nome === "QuotaExceededError" || (e && e.code === 22)) codigo = "sem_espaco";
    else if (nome === "SecurityError" || nome === "InvalidStateError" || nome === "VersionError" || nome === "indisponivel") codigo = "indisponivel";
    return erro(codigo, { causa: e });
  }

  function soCampos(obj, permitidos, onde) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw erro("outro");
    Object.keys(obj).forEach(function (k) {
      if (permitidos.indexOf(k) < 0) throw erro("campo_nao_permitido", { campo: k, onde: onde });
    });
  }

  function copia(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function pedir(req) {
    return new Promise(function (ok, falha) {
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { falha(req.error); };
    });
  }

  // Operações de uma transação aberta (as mesmas dentro de transacao()).
  function operacoes(tx) {
    return {
      lancamentos: {
        gravar: function (reg) {
          soCampos(reg, CAMPOS_LANCAMENTO, "lancamentos");
          return pedir(tx.objectStore("lancamentos").put(copia(reg))).then(function () { return undefined; });
        },
        obter: function (id) {
          return pedir(tx.objectStore("lancamentos").get(id)).then(function (r) { return r === undefined ? null : r; });
        },
        todos: function () {
          return pedir(tx.objectStore("lancamentos").getAll());
        },
        // Do mais novo ao mais antigo, incluindo apagados (quem esconde é js/lancamentos.js).
        doMes: function (mes) {
          return pedir(tx.objectStore("lancamentos").index("data").getAll()).then(function (lista) {
            return lista.filter(function (l) { return String(l.data).slice(0, 7) === mes; })
              .sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : 0; });
          });
        },
      },
      categorias: {
        gravar: function (lista) {
          return pedir(tx.objectStore("categorias").put({ chave: "lista", valor: copia(lista) })).then(function () { return undefined; });
        },
        ler: function () {
          return pedir(tx.objectStore("categorias").get("lista")).then(function (r) { return r ? r.valor : null; });
        },
      },
      config: {
        obter: function (chave) {
          return pedir(tx.objectStore("config").get(chave)).then(function (r) { return r ? r.valor : null; });
        },
        definir: function (chave, valor) {
          if (CHAVES_CONFIG.indexOf(chave) < 0) throw erro("campo_nao_permitido", { campo: chave, onde: "config" });
          return pedir(tx.objectStore("config").put({ chave: chave, valor: valor === undefined ? null : valor })).then(function () { return undefined; });
        },
      },
      fila: {
        acrescentar: function (entrada) {
          soCampos(entrada, CAMPOS_FILA.slice(1), "fila");
          if (entrada.seq !== undefined) throw erro("campo_nao_permitido", { campo: "seq", onde: "fila" });
          soCampos(entrada.registro, CAMPOS_REGISTRO, "fila.registro");
          return pedir(tx.objectStore("fila").add(copia(entrada)));
        },
        todas: function () {
          return pedir(tx.objectStore("fila").getAll()).then(function (l) {
            return l.sort(function (a, b) { return a.seq - b.seq; });
          });
        },
        substituir: function (seq, entrada) {
          soCampos(entrada, CAMPOS_FILA, "fila");
          soCampos(entrada.registro, CAMPOS_REGISTRO, "fila.registro");
          var nova = copia(entrada);
          nova.seq = seq;
          return pedir(tx.objectStore("fila").put(nova)).then(function () { return undefined; });
        },
        remover: function (seq) {
          return pedir(tx.objectStore("fila").delete(seq)).then(function () { return undefined; });
        },
        contar: function () {
          return pedir(tx.objectStore("fila").count());
        },
      },
    };
  }

  // Versão 1. Quando existir a versão 2, tratar aqui por oldVersion (ex.: if (antiga < 2) { ... }).
  function aoAtualizar(db, antiga) {
    if (antiga < 1) {
      var l = db.createObjectStore("lancamentos", { keyPath: "id" });
      l.createIndex("data", "data");
      db.createObjectStore("categorias", { keyPath: "chave" });
      db.createObjectStore("config", { keyPath: "chave" });
      db.createObjectStore("fila", { keyPath: "seq", autoIncrement: true });
    }
  }

  function abrir(fabrica) {
    if (fabrica === undefined) fabrica = typeof indexedDB !== "undefined" ? indexedDB : null;
    return new Promise(function (ok, falha) {
      if (!fabrica) return falha(erro("indisponivel"));
      var req;
      try { req = fabrica.open(NOME, VERSAO); } catch (e) { return falha(traduzir(e)); }
      req.onupgradeneeded = function (ev) { aoAtualizar(req.result, ev.oldVersion || 0); };
      req.onblocked = function () { falha(erro("indisponivel")); };
      req.onerror = function () { falha(traduzir(req.error)); };
      req.onsuccess = function () { ok(montar(req.result)); };
    });
  }

  function montar(idb) {
    function fazer(lojas, fn) {
      return new Promise(function (ok, falha) {
        var tx, resultado, motivo = null;
        try { tx = idb.transaction(lojas, "readwrite"); } catch (e) { return falha(traduzir(e)); }
        tx.oncomplete = function () { ok(resultado); };
        tx.onabort = function () { falha(traduzir(motivo || tx.error)); };
        Promise.resolve().then(function () { return fn(operacoes(tx)); }).then(
          function (r) { resultado = r; },
          function (e) { motivo = e; try { tx.abort(); } catch (_) { /* já abortada */ } }
        );
      });
    }
    function uma(loja) {
      return function (nome) {
        return function () {
          var args = arguments;
          return fazer([loja], function (o) { return o[loja][nome].apply(null, args); });
        };
      };
    }
    function grupo(loja, nomes) {
      var g = {};
      nomes.forEach(function (n) { g[n] = uma(loja)(n); });
      return g;
    }
    return {
      lancamentos: grupo("lancamentos", ["gravar", "obter", "todos", "doMes"]),
      categorias: grupo("categorias", ["gravar", "ler"]),
      config: grupo("config", ["obter", "definir"]),
      fila: grupo("fila", ["acrescentar", "todas", "substituir", "remover", "contar"]),
      // Tudo ou nada: se fn lança erro (ou devolve promessa rejeitada), nada é gravado em nenhuma loja.
      transacao: fazer,
      fechar: function () { idb.close(); },
    };
  }

  return { NOME: NOME, VERSAO: VERSAO, CAMPOS_REGISTRO: CAMPOS_REGISTRO, abrir: abrir, traduzir: traduzir };
})();
if (typeof module !== "undefined") module.exports = Db;
