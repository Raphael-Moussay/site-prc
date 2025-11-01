import { defineConfig } from 'vite';

export default defineConfig({
  // When hosting on GitHub Pages at https://<owner>/<repo>/, set base accordingly
  // Replace "/site-prc/" if your repository name changes.
  base: '/site-prc/',
  build: {
    // Build into "docs" so GitHub Pages can serve from the main branch
    outDir: 'docs',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/v1': {
        target: 'https://cloud.appwrite.io',
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (!cookies) return;
            proxyRes.headers['set-cookie'] = cookies.map((cookie) =>
              cookie
                .replace(/Domain=[^;]+/i, '')     // retire Domain=.cloud.appwrite.io
                .replace(/; SameSite=None/gi, '; SameSite=Lax') // évite le blocage
                .replace(/; Secure/gi, '') // autorise le cookie sur http://localhost
                .replace(/;;+/g, ';')
                .replace(/;\s+;/g, ';')
            );
          });
        },
      },
    },
  },
});