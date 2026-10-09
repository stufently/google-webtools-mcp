# Built from source in the image, so `docker build .` needs no local dist/.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY bin ./bin
COPY src ./src
RUN npm run build

FROM node:20-slim
# The MCP registry checks this label against the name in server.json before it
# accepts the image as this server's package.
LABEL io.modelcontextprotocol.server.name="io.github.stufently/google-webtools-mcp" \
      org.opencontainers.image.source="https://github.com/stufently/google-webtools-mcp" \
      org.opencontainers.image.description="MCP server for Google Search Console and Google Analytics 4" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/cli.js"]
