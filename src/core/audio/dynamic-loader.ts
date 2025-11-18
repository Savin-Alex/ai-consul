type SupportedDependency =
  | '@xenova/transformers'
  | 'onnxruntime-node'
  | 'onnxruntime-web'
  | 'python-shell'
  | 'ws'
  | 'assemblyai'
  | '@deepgram/sdk';

export class DynamicDependencyLoader {
  private cache = new Map<SupportedDependency, unknown>();

  async load<T = unknown>(name: SupportedDependency): Promise<T> {
    if (this.cache.has(name)) {
      return this.cache.get(name) as T;
    }

    const module = await this.dynamicImport<T>(name);
    this.cache.set(name, module);
    return module;
  }

  private async dynamicImport<T>(specifier: string): Promise<T> {
    const importer = new Function('specifier', 'return import(specifier)');
    return importer(specifier) as Promise<T>;
  }

  clear(): void {
    this.cache.clear();
  }
}

export const dependencyLoader = new DynamicDependencyLoader();

