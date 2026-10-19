import { generateDependencyReport } from '@discordjs/voice';
import { CaptionBot } from '../src/bot.js';
console.log(generateDependencyReport());
console.log('Bot module:', typeof CaptionBot);
