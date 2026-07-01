# Official Playwright image: bundles Node.js + Chromium and all the OS
# libraries the browser needs. Replaces the old selenium/standalone-chrome +
# manual Node install + chromedriver-from-Google-storage stack.
# The tag MUST match the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . /app

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
