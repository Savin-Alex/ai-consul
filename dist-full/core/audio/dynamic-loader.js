"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dependencyLoader = exports.DynamicDependencyLoader = void 0;
class DynamicDependencyLoader {
    cache = new Map();
    async load(name) {
        if (this.cache.has(name)) {
            return this.cache.get(name);
        }
        const module = await this.dynamicImport(name);
        this.cache.set(name, module);
        return module;
    }
    async dynamicImport(specifier) {
        const importer = new Function('specifier', 'return import(specifier)');
        return importer(specifier);
    }
    clear() {
        this.cache.clear();
    }
}
exports.DynamicDependencyLoader = DynamicDependencyLoader;
exports.dependencyLoader = new DynamicDependencyLoader();
