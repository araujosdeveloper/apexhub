FROM node:22-alpine
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY backend/server.js ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/integration ./integration
COPY backend/test-support ./test-support
# Fixtures podem ter modo 0600 na origem; o usuário dos testes precisa ser o dono.
COPY --chown=node:node backend/test ./test
COPY frontend /app/frontend
COPY database /app/database
COPY --chown=node:node scripts/ensure-jwt-keys.js scripts/master-recovery-payload.js scripts/setup-master-auto.js scripts/check-menu-ai.js /app/scripts/
USER node
EXPOSE 3000
CMD ["node", "server.js"]
