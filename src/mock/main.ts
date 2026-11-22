#!/usr/bin/env node
import { createWorldMock } from './index.js';

const port = Number(process.env.WORLD_MOCK_PORT ?? 4010);
const mock = createWorldMock();
const url = await mock.listen(port);
console.log(`.WORLD-Mock läuft unter ${url}`);
console.log('Test-Zugänge: admin/admin (2FA-Code 123456), mitglied/mitglied, inaktiv/inaktiv');
