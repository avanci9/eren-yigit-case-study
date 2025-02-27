FROM node:18-alpine as base

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
FROM base as dependencies
RUN npm ci --only=production

# Build the app
FROM base as build
COPY . .
RUN npm ci && npm test

# Production image
FROM base as production
ENV NODE_ENV=production

# Copy dependencies from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy app source
COPY . .

# Set non-root user for security
USER node

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Run the app
CMD ["node", "app/app.js"]