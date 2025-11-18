"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTransformers = loadTransformers;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const dynamic_loader_1 = require("./dynamic-loader");
let cachedPipeline = null;
let cachedEnv = null;
let envConfigured = false;
function configureTransformersEnv() {
    if (!cachedEnv || envConfigured) {
        return;
    }
    cachedEnv.allowRemoteModels = true;
    cachedEnv.allowLocalModels = true;
    cachedEnv.useBrowserCache = false;
    const cacheDir = process.env.TRANSFORMERS_CACHE ??
        process.env.HF_HOME ??
        path.join(os.homedir(), '.cache', 'ai-consul', 'transformers');
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    catch (error) {
        console.warn('[transformers] Failed to create cache directory:', error);
    }
    cachedEnv.cacheDir = cacheDir;
    cachedEnv.localModelPath = cacheDir;
    const token = process.env.HF_TOKEN ??
        process.env.HF_ACCESS_TOKEN ??
        process.env.HF_API_TOKEN ??
        process.env.HUGGINGFACE_TOKEN ??
        process.env.HUGGINGFACEHUB_API_TOKEN ??
        process.env.HUGGING_FACE_HUB_TOKEN;
    if (token) {
        process.env.HF_TOKEN ||= token;
        process.env.HF_ACCESS_TOKEN ||= token;
    }
    envConfigured = true;
}
async function loadTransformers() {
    if (!cachedPipeline || !cachedEnv) {
        const transformers = await dynamic_loader_1.dependencyLoader.load('@xenova/transformers');
        cachedPipeline = transformers.pipeline;
        cachedEnv = transformers.env;
        configureTransformersEnv();
    }
    return { pipeline: cachedPipeline, env: cachedEnv };
}
