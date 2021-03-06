/*
	Copyright (C) 2017 Balena Ltd.

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
import * as _ from 'lodash';

import * as utils from '../utils';
import { APIError, captureException } from '../utils/errors';

const authHeader = (auth?: Buffer): { Authorization?: string } => {
	const headers: { Authorization?: string } = {};
	if (auth != null) {
		headers.Authorization = `Bearer ${auth.toString()}`;
	}
	return headers;
};

export interface DeviceInfo {
	id: number;
	uuid: string;
	is_connected_to_vpn: boolean;
}

export const getDeviceByUUID = (
	uuid: string,
	auth?: Buffer,
): Promise<DeviceInfo> =>
	utils.balenaApi
		.get({
			resource: 'device',
			options: {
				$select: ['id', 'uuid', 'is_connected_to_vpn'],
				$filter: {
					uuid,
				},
			},
			passthrough: { headers: authHeader(auth) },
		})
		.then(devices => {
			if (!_.isArray(devices)) {
				throw new Error('invalid api response');
			}
			return devices[0] as DeviceInfo;
		})
		.catch(err => {
			captureException(err, err.message);
			throw new APIError(err.message);
		});

export const canAccessDevice = (
	device: DeviceInfo,
	port: number,
	auth?: Buffer,
) =>
	utils.balenaApi
		.post({
			resource: 'device',
			id: device.id,
			passthrough: { headers: authHeader(auth) },
			body: {
				action: `tunnel-${port}`,
			},
			url: `device(${device.id})/canAccess`,
		})
		.then(
			({ d }: { d?: Array<{ id: number }> }) =>
				_.isArray(d) && d.length === 1 && d[0].id === device.id,
		)
		.catchReturn(false);

export const getDeviceVpnHost = (
	uuid: string,
	auth?: Buffer,
): Promise<string> =>
	utils.balenaApi
		.get({
			resource: 'service_instance',
			options: {
				$select: 'ip_address',
				$filter: {
					manages__device: {
						$any: {
							$alias: 'd',
							$expr: { d: { uuid } },
						},
					},
				},
			},
			passthrough: { headers: authHeader(auth) },
		})
		.then(
			(devices): string => {
				if (!_.isArray(devices)) {
					throw new Error('invalid api response');
				}
				return devices[0].ip_address;
			},
		)
		.catch(err => {
			captureException(err, err.message);
			throw new APIError(`cannot find device vpn host (${err.message})`);
		});
