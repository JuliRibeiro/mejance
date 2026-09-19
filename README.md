# Maqam — protótipo

Site estático, sem dependências de build. Para publicar no GitHub Pages:

1. Crie um repositório no GitHub.
2. Coloque `index.html` e `app.js` na raiz (ou numa pasta `docs/`).
3. Em Settings > Pages, escolha a branch e a pasta onde estão os arquivos.
4. O GitHub gera uma URL do tipo `https://SEU-USUARIO.github.io/SEU-REPO/`.

## O que já funciona
- **Editar áudio**: totalmente funcional, roda no navegador (Web Audio API).
- **Compor por encomenda**: gera e exporta ritmos árabes sintetizados (dum/tek) em WAV.
- **Reconhecer ritmo**: protótipo experimental por heurística de sinal (energia + correlação), não é um modelo de ML — ver a proposta para o caminho até uma versão com classificador treinado.
