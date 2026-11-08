/**
 * Flow builder (SDK studio) flow storage: the /api/cdap-studio/flows routes
 * against a real SQLite adapter on a temporary database.
 *
 * Set BETTERDESK_TEST_DATABASE_URL to an empty, throwaway Postgres database
 * to run the same cases against the Postgres adapter.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

jest.setTimeout(30000);

const ENV_KEYS = ['DATA_DIR', 'DB_TYPE', 'DB_PATH', 'DATABASE_URL', 'SQLITE_AUTH_DB_MODE'];

const backends = [['sqlite', null]];
if (process.env.BETTERDESK_TEST_DATABASE_URL) {
    backends.push(['postgres', process.env.BETTERDESK_TEST_DATABASE_URL]);
}

describe.each(backends)('flow builder flow routes (%s)', (backend, databaseUrl) => {
    let tmpDir;
    let adapter;
    let routes;
    const savedEnv = {};

    beforeAll(async () => {
        for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-studio-flows-'));
        process.env.DATA_DIR = tmpDir;
        process.env.SQLITE_AUTH_DB_MODE = 'consolidated';
        if (databaseUrl) {
            process.env.DB_TYPE = 'postgres';
            process.env.DATABASE_URL = databaseUrl;
        } else {
            process.env.DB_TYPE = 'sqlite';
            process.env.DB_PATH = path.join(tmpDir, 'db_v2.sqlite3');
            delete process.env.DATABASE_URL;
        }
        jest.resetModules();
        adapter = require('../services/dbAdapter').getAdapter();
        await adapter.init();
        routes = require('../routes/cdap-studio.routes');
    });

    afterAll(async () => {
        if (adapter) {
            if (databaseUrl) {
                const flows = await adapter.listStudioFlows();
                for (const f of flows) await adapter.deleteStudioFlow(f.id);
            }
            await adapter.close();
        }
        for (const key of ENV_KEYS) {
            if (savedEnv[key] === undefined) delete process.env[key];
            else process.env[key] = savedEnv[key];
        }
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    /** An app signed in as the given user; null means signed out. */
    function appAs(user) {
        const app = express();
        app.use(express.json({ limit: '10mb' }));
        app.use((req, _res, next) => {
            req.session = user ? { userId: user.id, user } : {};
            req.t = (key) => key;
            next();
        });
        app.use(routes);
        return app;
    }

    const alice = { id: 2, username: 'alice', role: 'operator' };
    const bob = { id: 3, username: 'bob', role: 'operator' };
    const viewer = { id: 4, username: 'vera', role: 'viewer' };
    const admin = { id: 1, username: 'root', role: 'super_admin' };

    const flowJson = JSON.stringify({
        nodes: [{ id: 'n1', type: 'modbus-tcp', label: 'Read' }, { id: 'n2', type: 'log' }],
        wires: [{ from: 'n1', to: 'n2', fromPort: 'out', toPort: 'in' }]
    });

    async function createFlow(user, body) {
        const res = await request(appAs(user)).post('/api/cdap-studio/flows').send(body);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.id).toBe('string');
        return res.body.id;
    }

    test('create, list, get, update and delete a flow', async () => {
        const app = appAs(alice);
        const id = await createFlow(alice, { name: '  Temperature  ', description: 'Reads the PLC', flow_json: flowJson });

        const list = await request(app).get('/api/cdap-studio/flows');
        expect(list.status).toBe(200);
        expect(list.body.success).toBe(true);
        const listed = list.body.flows.find((f) => f.id === id);
        expect(listed).toMatchObject({
            id, name: 'Temperature', description: 'Reads the PLC',
            status: 'draft', version: 1, created_by: 'alice'
        });
        expect(listed.flow_json).toBeUndefined();
        expect(Number.isNaN(Date.parse(listed.updated_at))).toBe(false);

        const got = await request(app).get(`/api/cdap-studio/flows/${id}`);
        expect(got.status).toBe(200);
        expect(got.body.flow).toMatchObject({ id, name: 'Temperature', created_by: 'alice' });
        expect(JSON.parse(got.body.flow.flow_json)).toEqual(JSON.parse(flowJson));

        const newJson = JSON.stringify({ nodes: [{ id: 'n1', type: 'log' }], wires: [] });
        const put = await request(app).put(`/api/cdap-studio/flows/${id}`)
            .send({ name: 'Temperature v2', description: 'Changed', flow_json: newJson });
        expect(put.status).toBe(200);
        expect(put.body).toEqual({ success: true });

        const after = await request(app).get(`/api/cdap-studio/flows/${id}`);
        expect(after.body.flow).toMatchObject({ name: 'Temperature v2', description: 'Changed', version: 2 });
        expect(JSON.parse(after.body.flow.flow_json)).toEqual({ nodes: [{ id: 'n1', type: 'log' }], wires: [] });

        const del = await request(app).delete(`/api/cdap-studio/flows/${id}`);
        expect(del.status).toBe(200);
        expect(del.body).toEqual({ success: true });
        expect((await request(app).get(`/api/cdap-studio/flows/${id}`)).status).toBe(404);
        const listAfter = await request(app).get('/api/cdap-studio/flows');
        expect(listAfter.body.flows.some((f) => f.id === id)).toBe(false);
    });

    test('an update without flow_json keeps the stored flow', async () => {
        const id = await createFlow(alice, { name: 'Keep', description: 'Stays', flow_json: flowJson });
        const res = await request(appAs(alice)).put(`/api/cdap-studio/flows/${id}`).send({ name: 'Renamed' });
        expect(res.status).toBe(200);
        const got = await request(appAs(alice)).get(`/api/cdap-studio/flows/${id}`);
        expect(got.body.flow).toMatchObject({ name: 'Renamed', description: 'Stays' });
        expect(got.body.flow.flow_json).toBe(flowJson);
    });

    test('deploy, test run, export and import', async () => {
        const app = appAs(alice);
        const id = await createFlow(alice, { name: 'Deploy me', flow_json: flowJson });

        const deploy = await request(app).post(`/api/cdap-studio/flows/${id}/deploy`);
        expect(deploy.body).toEqual({ success: true, status: 'deployed' });
        expect((await request(app).get(`/api/cdap-studio/flows/${id}`)).body.flow.status).toBe('deployed');

        const run = await request(app).post(`/api/cdap-studio/flows/${id}/test`);
        expect(run.status).toBe(200);
        expect(run.body).toMatchObject({ success: true, nodeCount: 2, wireCount: 1 });
        expect(run.body.results.map((r) => r.nodeId)).toEqual(['n1', 'n2']);

        const exp = await request(app).get(`/api/cdap-studio/flows/${id}/export`);
        expect(exp.status).toBe(200);
        expect(exp.headers['content-disposition']).toContain('Deploy_me.bdflow');
        const file = JSON.parse(exp.text);
        expect(file).toMatchObject({ format: 'bdflow', name: 'Deploy me', exportedBy: 'alice' });

        const imp = await request(app).post('/api/cdap-studio/flows/import')
            .send({ name: 'Copy', description: file.description, flow: file.flow });
        expect(imp.status).toBe(200);
        const copy = await request(app).get(`/api/cdap-studio/flows/${imp.body.id}`);
        expect(copy.body.flow).toMatchObject({ name: 'Copy', status: 'draft', created_by: 'alice' });
        expect(JSON.parse(copy.body.flow.flow_json)).toEqual(JSON.parse(flowJson));
    });

    test('rejects a missing name and flow data that is not JSON', async () => {
        const app = appAs(alice);
        expect((await request(app).post('/api/cdap-studio/flows').send({ name: '   ', flow_json: '{}' })).status).toBe(400);
        expect((await request(app).post('/api/cdap-studio/flows').send({ name: 'x'.repeat(101) })).status).toBe(400);
        expect((await request(app).post('/api/cdap-studio/flows').send({ name: 'Bad', flow_json: '{nope' })).status).toBe(400);
        expect((await request(app).post('/api/cdap-studio/flows/import').send({ name: 'Bad' })).status).toBe(400);
    });

    test('owners, other operators, viewers and admins', async () => {
        const id = await createFlow(alice, { name: 'Private', flow_json: flowJson });

        // Signed out
        expect((await request(appAs(null)).get('/api/cdap-studio/flows')).status).toBe(401);

        // Another operator neither sees nor changes it
        const bobApp = appAs(bob);
        const bobList = await request(bobApp).get('/api/cdap-studio/flows');
        expect(bobList.status).toBe(200);
        expect(bobList.body.flows.some((f) => f.id === id)).toBe(false);
        expect((await request(bobApp).get(`/api/cdap-studio/flows/${id}`)).status).toBe(404);
        expect((await request(bobApp).get(`/api/cdap-studio/flows/${id}/export`)).status).toBe(404);
        expect((await request(bobApp).post(`/api/cdap-studio/flows/${id}/test`)).status).toBe(404);
        expect((await request(bobApp).put(`/api/cdap-studio/flows/${id}`).send({ name: 'Mine now' })).status).toBe(403);
        expect((await request(bobApp).post(`/api/cdap-studio/flows/${id}/deploy`)).status).toBe(403);
        expect((await request(bobApp).delete(`/api/cdap-studio/flows/${id}`)).status).toBe(403);

        // A viewer can list (their own, none) but not create or change
        const viewerApp = appAs(viewer);
        expect((await request(viewerApp).get('/api/cdap-studio/flows')).body.flows).toEqual([]);
        expect((await request(viewerApp).post('/api/cdap-studio/flows').send({ name: 'No', flow_json: '{}' })).status).toBe(403);
        expect((await request(viewerApp).delete(`/api/cdap-studio/flows/${id}`)).status).toBe(403);

        // A super admin sees and changes everyone's flows
        const adminApp = appAs(admin);
        const adminList = await request(adminApp).get('/api/cdap-studio/flows');
        expect(adminList.body.flows.some((f) => f.id === id)).toBe(true);
        expect((await request(adminApp).put(`/api/cdap-studio/flows/${id}`).send({ name: 'Checked' })).status).toBe(200);
        expect((await request(adminApp).delete(`/api/cdap-studio/flows/${id}`)).status).toBe(200);
        expect((await request(appAs(alice)).get(`/api/cdap-studio/flows/${id}`)).status).toBe(404);
    });
});
