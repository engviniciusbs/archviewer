import ignore, { type Ignore } from 'ignore';

/** Uma instância de `ignore` por diretório; cada uma julga caminhos relativos ao seu diretório. */
export class GitignoreStack {
  private readonly layers: { dir: string; ig: Ignore }[] = [];

  add(dir: string, content: string): void {
    this.layers.push({ dir, ig: ignore().add(content) });
  }

  ignores(path: string, isDir: boolean): boolean {
    for (const { dir, ig } of this.layers) {
      let rel: string;
      if (dir === '') rel = path;
      else if (path.startsWith(`${dir}/`)) rel = path.slice(dir.length + 1);
      else continue;
      if (ig.ignores(isDir ? `${rel}/` : rel)) return true;
    }
    return false;
  }
}
