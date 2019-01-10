/*
	Copyright (C) 2018 Balena Ltd.

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as _ from 'lodash';
import * as redis from 'redis';
import * as fs from 'fs';
import { Docker } from 'node-docker-api';
import { promisify } from 'util';

import { captureException, logger } from '../utils';

import { clients, request } from './utils';

const redisScan = require('node-redis-scan');

const BALENA_API_HOST = process.env.BALENA_API_HOST!;

const db = redis.createClient({
	host: '127.0.0.1',
	port: 6379,
});
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Private endpoints should use the `fromLocalHost` middleware.
const fromLocalHost: express.RequestHandler = (req, res, next) => {
	// '::ffff:127.0.0.1' is the ipv4 mapped ipv6 address and ::1 is the ipv6 loopback
	if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.ip)) {
		return res.sendStatus(401);
	}

	next();
};

const regenerateConfig = () => {
	const scanner = new redisScan(db);
	scanner.scan('*', async (_: any, matchingKeys: string[]) => {
		const getAsync = promisify(db.get).bind(db);
		const keyValues = await Promise.all(
			matchingKeys.map(async key => ({ key, value: await getAsync(key) })),
		);
		const fileContents = `
worker_processes 1;

events {
		worker_connections 1024;
}

map $ssl_preread_server_name $backend {
  ${keyValues.map(({ key, value }) => `${key} ${value}:443\n`)}
}

map $ssl_preread_protocol $upstream {
  ""        127.0.0.1:1194;
  default   $backend:443;
}

server {
		listen      443;
		proxy_pass  $upstream;
		ssl_preread on;
}
`;
		fs.writeFileSync('/etc/nginx/nginx.conf', fileContents);

		const nginx = docker.container.get('vpn_nginx');
		nginx.kill('SIGHUP');
	});
};

const apiFactory = () => {
	const api = express.Router();

	const exists = _.negate(_.isNil);
	const isValid = _.conforms({
		common_name: exists,
		virtual_address: exists,
		real_address: exists,
		trusted_port: exists,
	});

	api.use(bodyParser.json());

	api.post('/api/v1/clients/', fromLocalHost, (req, res) => {
		if (!isValid(req.body)) {
			return res.sendStatus(400);
		}
		clients.connected(req.body);
		db.set(req.body.common_name, req.body.virtual_address);
		regenerateConfig();
		res.send('OK');
	});

	api.post('/api/v1/auth/', fromLocalHost, function(req, res) {
		if (req.body.username == null) {
			logger.info('AUTH FAIL: UUID not specified.');
			return res.sendStatus(400);
		}

		if (req.body.password == null) {
			logger.info('AUTH FAIL: API Key not specified.');
			return res.sendStatus(400);
		}

		request({
			url: `https://${BALENA_API_HOST}/services/vpn/auth/${req.body.username}`,
			timeout: 30000,
			headers: { Authorization: `Bearer ${req.body.password}` },
		})
			.then(response => {
				if (response.statusCode === 200) {
					return res.send('OK');
				} else {
					logger.info(
						`AUTH FAIL: API Authentication failed for ${req.body.username}`,
					);
					return res.sendStatus(401);
				}
			})
			.catch(err => {
				captureException(err, 'Proxy Auth Error', { req });
				res.sendStatus(401);
			});
	});

	api.delete('/api/v1/clients/', fromLocalHost, (req, res) => {
		if (!isValid(req.body)) {
			return res.sendStatus(400);
		}

		clients.disconnected(req.body);
		db.del(req.body.common_name);
		regenerateConfig();
		res.send('OK');
	});

	return api;
};
export default apiFactory;
