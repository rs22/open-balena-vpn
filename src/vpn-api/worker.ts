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

import * as Promise from 'bluebird';
import * as compression from 'compression';
import * as express from 'express';
import * as morgan from 'morgan';

import { logger } from '../utils';
import { Raven } from '../utils/errors';

import apiFactory from './api';

interface AsyncApplication extends express.Application {
	listenAsync(port: number): Promise<ReturnType<express.Application['listen']>>;
}

[
	'BALENA_API_HOST',
	'VPN_SERVICE_API_KEY',
	'VPN_HOST',
	'VPN_API_BASE_PORT',
]
	.filter(key => process.env[key] == null)
	.forEach((key, idx, keys) => {
		logger.error(`${key} env variable is not set.`);
		if (idx === keys.length - 1) {
			process.exit(1);
		}
	});

const VPN_API_BASE_PORT = parseInt(process.env.VPN_API_BASE_PORT!, 10);


const worker = (instanceId: number) => {
	logger.info(`worker-${instanceId} process started with pid ${process.pid}`);

	const apiPort = VPN_API_BASE_PORT + instanceId;

	const app = (Promise.promisifyAll(express()) as any) as AsyncApplication;
	app.disable('x-powered-by');
	app.get('/ping', (_req, res) => res.send('OK'));
	app.use(morgan('combined'));
	app.use(compression());
	app.use(apiFactory());
	app.use(Raven.errorHandler());

	return app
		.listenAsync(apiPort)
		.tap(() =>
			logger.info(
				`open-balena-vpn worker-${instanceId} listening on port ${apiPort}`,
			),
		)
		.return(true);
};
export default worker;
