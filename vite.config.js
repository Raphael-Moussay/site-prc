import { defineConfig } from 'vite';

export default defineConfig({
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