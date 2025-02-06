import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // define: {
  //   'process.env.VITE_APP_GOOGLE_AI' : JSON.stringify(process.env.VITE_APP_GOOGLE_AI),
  //   'process.env.VITE_APP_DEEPGRAM_API' : JSON.stringify(process.env.VITE_APP_DEEPGRAM_API)  
  //   }
})
