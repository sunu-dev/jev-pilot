#!/usr/bin/env node
import { entry } from '../src/cli.mjs';
entry(['claude', ...process.argv.slice(2)]);
