FROM node:8-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json /usr/src/app/
RUN npm ci --unsafe-perm --production --ignore-scripts && npm cache clean --force

COPY . /usr/src/app

RUN npm run build

CMD ["node", "build/src/vpn-api/app.js"]
