FROM node:20-slim

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --immutable

COPY . .

EXPOSE 3001

CMD ["yarn", "start"]
