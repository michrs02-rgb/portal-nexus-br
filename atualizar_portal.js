/**
 * Portal Nexus BR - Script de Automação Editorial Autônoma
 * Arquivo: atualizar_portal.js
 * 
 * Funcionalidades:
 * 1. Consome feeds RSS confiáveis de Finanças, E-commerce e Tecnologia.
 * 2. Filtra a notícia mais relevante das últimas 24h que ainda não esteja no acervo.
 * 3. Utiliza a API do Google Gemini (lendo GEMINI_API_KEY do .env) para reescrita jornalística profunda e imparcial.
 * 4. Valida e formata os dados no esquema exato do artigos.json.
 * 5. Insere a matéria na primeira posição do artigos.json e salva o arquivo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Parser from 'rss-parser';

// Carrega variáveis do arquivo .env com prioridade sobre o ambiente do sistema
dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIGOS_PATH = path.join(__dirname, 'artigos.json');

// Lista de fontes RSS abertas e confiáveis em Português do Brasil
const FONTES_RSS = [
  {
    nome: 'G1 Economia',
    url: 'https://g1.globo.com/rss/g1/economia/',
    categoriaPadrao: 'Finanças Práticas'
  },
  {
    nome: 'InfoMoney',
    url: 'https://www.infomoney.com.br/feed/',
    categoriaPadrao: 'Finanças Práticas'
  },
  {
    nome: 'Olhar Digital',
    url: 'https://olhardigital.com.br/feed/',
    categoriaPadrao: 'Tecnologia & Golpes'
  },
  {
    nome: 'Agência Brasil Economia',
    url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml',
    categoriaPadrao: 'Finanças Práticas'
  }
];

// Imagens temáticas de alta qualidade jornalística para fallback
const IMAGENS_FALLBACK = {
  'Finanças Práticas': [
    'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80'
  ],
  'E-commerce & MEI': [
    'https://images.unsplash.com/photo-1556742049-0a67c5574f73?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1556740758-90de374c12ad?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80'
  ],
  'Tecnologia & Golpes': [
    'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1563986768494-4dee2763ff3f?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=800&q=80'
  ]
};

// Termos de alto impacto editorial para pontuação e seleção
const PALAVRAS_CHAVE_RELEVANCIA = [
  'pix', 'golpe', 'fraude', 'segurança', 'banco', 'selic', 'juros',
  'poupança', 'cdi', 'imposto', 'receita federal', 'fgts', 'salário',
  'shopee', 'mercado livre', 'mei', 'nota fiscal', 'whatsapp',
  'inss', 'abono', 'pis', 'caixa', 'rendimento', 'consumidor'
];

/**
 * Lê e analisa o arquivo artigos.json existente
 */
function carregarArtigosAtuais() {
  if (!fs.existsSync(ARTIGOS_PATH)) {
    console.warn('⚠️  Arquivo artigos.json não encontrado. Criando lista vazia.');
    return [];
  }
  try {
    const conteudo = fs.readFileSync(ARTIGOS_PATH, 'utf-8');
    const dados = JSON.parse(conteudo);
    if (Array.isArray(dados)) {
      return dados;
    }
    console.warn('⚠️  artigos.json não continha um array. Inicializando array vazio.');
    return [];
  } catch (erro) {
    console.error('❌ Erro ao ler artigos.json:', erro.message);
    throw erro;
  }
}

/**
 * Normaliza textos para checagem de similaridade e duplicatas
 */
function normalizarTexto(txt = '') {
  return txt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

/**
 * Extrai URL de imagem do item de feed RSS
 */
function extrairImagemDoRss(item) {
  if (item.enclosure && item.enclosure.url && item.enclosure.url.startsWith('http')) {
    return item.enclosure.url;
  }
  if (item['media:content'] && item['media:content'].$ && item['media:content'].$.url) {
    return item['media:content'].$.url;
  }
  if (item['media:thumbnail'] && item['media:thumbnail'].$ && item['media:thumbnail'].$.url) {
    return item['media:thumbnail'].$.url;
  }
  const content = item['content:encoded'] || item.content || '';
  const matchImg = content.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  if (matchImg && matchImg[1]) {
    return matchImg[1];
  }
  return null;
}

/**
 * Formata data no formato brasileiro DD/MM/AAAA
 */
function formatarDataBr(data = new Date()) {
  const d = new Date(data);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const ano = d.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

/**
 * Consome os feeds e seleciona a notícia mais relevante das últimas 24h
 */
async function obterNoticiaMaisRelevante(artigosAtuais) {
  const parser = new Parser({
    headers: {
      'User-Agent': 'PortalNexusBR-Bot/1.0 (+https://portalnexus.com.br)'
    },
    timeout: 10000
  });

  const titulosCadastrados = new Set(
    artigosAtuais.map(a => normalizarTexto(a.titulo))
  );

  const agora = Date.now();
  const limite24Horas = 24 * 60 * 60 * 1000;
  const candidatos = [];

  console.log('📡 Consumindo feeds RSS editoriais...');

  for (const fonte of FONTES_RSS) {
    try {
      // Faz o fetch com User-Agent e sanitiza espaços/BOM antes do XML
      const res = await fetch(fonte.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let textoXml = await res.text();
      textoXml = textoXml.replace(/^\uFEFF/, '').trim();

      const feed = await parser.parseString(textoXml);
      console.log(`   ✓ ${fonte.nome}: ${feed.items?.length || 0} matérias recebidas.`);

      for (const item of feed.items || []) {
        const tituloLimpo = normalizarTexto(item.title);
        if (!tituloLimpo) continue;

        // Verifica se a matéria já está no acervo
        let jaExiste = false;
        for (const cadastrado of titulosCadastrados) {
          if (cadastrado.includes(tituloLimpo) || tituloLimpo.includes(cadastrado)) {
            jaExiste = true;
            break;
          }
        }
        if (jaExiste) continue;

        // Avaliação temporal (prioriza últimas 24h)
        const dataItem = item.pubDate || item.isoDate ? new Date(item.pubDate || item.isoDate).getTime() : agora;
        const idadeHoras = (agora - dataItem) / (1000 * 60 * 60);
        const ehUltimas24h = (agora - dataItem) <= limite24Horas;

        // Cálculo de pontuação de relevância
        let pontuacao = 0;
        const textoCompleto = normalizarTexto(`${item.title} ${item.contentSnippet || ''}`);

        for (const termo of PALAVRAS_CHAVE_RELEVANCIA) {
          if (textoCompleto.includes(termo)) {
            pontuacao += 3;
          }
        }

        if (ehUltimas24h) pontuacao += 10;
        if (idadeHoras < 12) pontuacao += 5;

        candidatos.push({
          fonte: fonte.nome,
          categoriaPadrao: fonte.categoriaPadrao,
          title: item.title?.trim(),
          link: item.link,
          contentSnippet: item.contentSnippet || item.summary || '',
          content: item.content || item['content:encoded'] || '',
          dataPublicacao: item.pubDate || item.isoDate,
          imagemOriginal: extrairImagemDoRss(item),
          pontuacao,
          ehUltimas24h
        });
      }
    } catch (err) {
      console.warn(`   ⚠️ Falha ao ler feed ${fonte.nome}: ${err.message}`);
    }
  }

  if (candidatos.length === 0) {
    throw new Error('Nenhuma notícia nova encontrada nos feeds RSS.');
  }

  // Ordena por maior relevância editorial
  candidatos.sort((a, b) => b.pontuacao - a.pontuacao);
  const escolhida = candidatos[0];

  console.log(`\n🎯 Matéria selecionada para apuração:`);
  console.log(`   Título: "${escolhida.title}"`);
  console.log(`   Fonte: ${escolhida.fonte} | Relevância: ${escolhida.pontuacao} pts`);
  return escolhida;
}

/**
 * Envia o fato para a API do Google Gemini produzir a redação editorial
 */
async function redigirMateriaComGemini(noticia, apiKey) {
  const prompt = `Você é o editor-chefe sênior do Portal Nexus BR, um veículo de jornalismo prático com foco em Finanças, E-commerce & MEI e Tecnologia/Segurança Digital.

Sua tarefa é reescrever o fato a seguir com rigor técnico, imparcialidade e profundidade jornalística em Português do Brasil.

FATO BRUTO:
- Título: ${noticia.title}
- Resumo/Contexto: ${noticia.contentSnippet}
- Link da Fonte: ${noticia.link}

DIRETRIZES EDITORIAIS:
1. Tom: Jornalístico, aprofundado, imparcial, direto e explicativo para o cidadão e pequenos empreendedores.
2. Defina rigorosamente UMA das seguintes 3 categorias:
   - "Finanças Práticas"
   - "E-commerce & MEI"
   - "Tecnologia & Golpes"
3. Título: Crie um título claro, jornalístico e atraente (sem sensacionalismo barato).
4. Resumo: Sintetize em 1 a 2 frases concisas para o subtítulo/card.
5. Tempo de leitura: Estime os minutos (ex: "3" ou "4").
6. Conteúdo em HTML: Mínimo de 3 a 5 parágrafos organizados com tags <p> e subtítulos <h3> explicativos. Explique os antecedentes, o impacto prático e como o leitor deve proceder. NÃO use tags <h1> nem <h2>. NÃO inclua tags <html>, <head> ou <body>.
7. Retorne estritamente um JSON válido no formato abaixo, sem nenhum texto extra antes ou depois:
{
  "categoria": "Finanças Práticas",
  "titulo": "...",
  "resumo": "...",
  "tempo_leitura": "4",
  "conteudo_html": "<p>...</p><h3>Impacto para o Cidadão</h3><p>...</p>"
}`;

  console.log('🤖 Solicitando redação jornalística à inteligência do Google Gemini...');

  // Modelos suportados da família Gemini (com fallback)
  const modelos = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  let respostaTexto = '';
  let ultimoErro = null;

  for (const modelo of modelos) {
    try {
      const urlApi = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json'
        }
      };

      const res = await fetch(urlApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      respostaTexto = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (respostaTexto) {
        console.log(`   ✓ Matéria redigida com sucesso via modelo ${modelo}.`);
        break;
      }
    } catch (err) {
      ultimoErro = err;
      console.warn(`   ⚠️ Tentativa com ${modelo} falhou: ${err.message}. Tentando próximo...`);
    }
  }

  if (!respostaTexto) {
    throw new Error(`Falha ao obter redação do Gemini: ${ultimoErro?.message}`);
  }

  // Limpeza de possíveis blocos markdown json
  const jsonLimpo = respostaTexto
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();

  const dadosRedigidos = JSON.parse(jsonLimpo);

  // Normalização de categoria
  const categoriasValidas = ['Finanças Práticas', 'E-commerce & MEI', 'Tecnologia & Golpes'];
  if (!categoriasValidas.includes(dadosRedigidos.categoria)) {
    dadosRedigidos.categoria = noticia.categoriaPadrao || 'Finanças Práticas';
  }

  return dadosRedigidos;
}

/**
 * Seleciona imagem jornalística apropriada
 */
function definirImagemArtigo(noticia, categoria) {
  if (noticia.imagemOriginal && noticia.imagemOriginal.startsWith('https://')) {
    return noticia.imagemOriginal;
  }
  const listaImagens = IMAGENS_FALLBACK[categoria] || IMAGENS_FALLBACK['Finanças Práticas'];
  const indice = Math.floor(Math.random() * listaImagens.length);
  return listaImagens[indice];
}

/**
 * Calcula o próximo ID incremental
 */
function gerarNovoId(artigos) {
  let maiorId = 0;
  for (const a of artigos) {
    const num = parseInt(a.id, 10);
    if (!isNaN(num) && num > maiorId) {
      maiorId = num;
    }
  }
  return String(maiorId + 1);
}

/**
 * Pipeline Principal de Execução Autônoma
 */
async function executarPipeline() {
  const args = process.argv.slice(2);
  const modoSimulacao = args.includes('--simular') || args.includes('--dry-run');

  console.log('====================================================');
  console.log('   PORTAL NEXUS BR - PIPELINE EDITORIAL AUTÔNOMO   ');
  if (modoSimulacao) {
    console.log('   [MODO DE TESTE / SIMULAÇÃO ATIVADO]');
  }
  console.log('====================================================\n');

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!modoSimulacao && (!apiKey || apiKey === 'sua_chave_gemini_aqui' || apiKey.length < 30)) {
    console.error('❌ CONFIGURAÇÃO NECESSÁRIA - GEMINI_API_KEY:');
    console.error('   A chave de API do Google Gemini não foi encontrada ou é inválida.');
    console.error('   ------------------------------------------------------------');
    console.error('   1. Obtenha sua chave gratuita em: https://aistudio.google.com/');
    console.error('   2. Crie ou edite o arquivo .env no diretório raiz do projeto:');
    console.error('      GEMINI_API_KEY=AIzaSy...');
    console.error('   3. Execute o comando de produção:');
    console.error('      npm run atualizar');
    console.error('\n   💡 Dica: Para testar a conectividade de feeds e fluxo sem gastar cota, use:');
    console.error('      node atualizar_portal.js --simular\n');
    process.exit(1);
  }

  try {
    // 1. Carrega artigos existentes
    const artigosAtuais = carregarArtigosAtuais();
    console.log(`📂 Acervo atual: ${artigosAtuais.length} matérias cadastradas.`);

    // 2. Busca e filtra notícia relevante
    const noticia = await obterNoticiaMaisRelevante(artigosAtuais);

    // 3. Redige com Google Gemini (ou simula com base no RSS se for modo teste)
    let materiaRedigida;
    if (modoSimulacao && (!apiKey || apiKey.length < 30)) {
      console.log('🤖 [SIMULAÇÃO] Gerando redação estruturada de teste a partir do RSS...');
      materiaRedigida = {
        categoria: noticia.categoriaPadrao || 'Finanças Práticas',
        titulo: `${noticia.title}: impactos diretos no bolso e no mercado`,
        resumo: noticia.contentSnippet ? noticia.contentSnippet.slice(0, 160) + '...' : 'Análise detalhada sobre os desdobramentos práticos para finanças e negócios.',
        tempo_leitura: '3',
        conteudo_html: `<p>Os recentes desdobramentos sobre <strong>${noticia.title}</strong> colocam o mercado em estado de atenção quanto aos reflexos imediatos no poder de compra e nos custos operacionais.</p><h3>O que muda na prática</h3><p>${noticia.contentSnippet || 'A movimentação reflete ajustes macroeconômicos e exige cautela na gestão dos recursos pessoais e comerciais.'}</p><p>Para proteger seu patrimônio e tomar decisões assertivas, o acompanhamento diário das taxas e regras oficiais é indispensável.</p>`
      };
    } else {
      materiaRedigida = await redigirMateriaComGemini(noticia, apiKey);
    }

    // 4. Monta o novo artigo seguindo o padrão exato de artigos.json
    const novoArtigo = {
      id: gerarNovoId(artigosAtuais),
      data: formatarDataBr(new Date()),
      categoria: materiaRedigida.categoria,
      titulo: materiaRedigida.titulo?.trim(),
      resumo: materiaRedigida.resumo?.trim(),
      imagem_url: definirImagemArtigo(noticia, materiaRedigida.categoria),
      tempo_leitura: String(materiaRedigida.tempo_leitura || '3'),
      conteudo_html: materiaRedigida.conteudo_html?.trim()
    };

    // 5. Insere na primeira posição
    artigosAtuais.unshift(novoArtigo);

    // 6. Salva o arquivo artigos.json
    if (args.includes('--dry-run')) {
      console.log('\n🔍 [DRY-RUN] Salvamento em disco ignorado pelo modo de verificação.');
    } else {
      fs.writeFileSync(ARTIGOS_PATH, JSON.stringify(artigosAtuais, null, 2), 'utf-8');
      console.log(`💾 Arquivo salvo: ${ARTIGOS_PATH} (${artigosAtuais.length} matérias no acervo)`);
    }

    console.log('\n====================================================');
    console.log('✅ PUBLICAÇÃO CONCLUÍDA COM SUCESSO!');
    console.log('====================================================');
    console.log(`📌 ID: ${novoArtigo.id}`);
    console.log(`📅 Data: ${novoArtigo.data}`);
    console.log(`🏷️  Categoria: ${novoArtigo.categoria}`);
    console.log(`📰 Título: ${novoArtigo.titulo}`);
    console.log(`⏱️  Tempo de leitura: ${novoArtigo.tempo_leitura} min`);
    console.log(`💾 Arquivo salvo: ${ARTIGOS_PATH} (${artigosAtuais.length} matérias no acervo)`);
    console.log('====================================================\n');
  } catch (erro) {
    console.error('\n❌ Erro durante a execução do pipeline:');
    console.error(erro.message);
    process.exit(1);
  }
}

executarPipeline();
