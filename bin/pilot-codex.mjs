#!/usr/bin/env node
import { entry } from '../src/cli.mjs';
entry(['codex', ...process.argv.slice(2)]);
