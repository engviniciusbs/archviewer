export async function loadHeavyModule() {
  const module = await import('../utils/helpers');
  return module.slugify('hello world');
}

export async function loadComponent() {
  const { Button } = await import('../components/Button');
  return Button;
}
