// Ponte segura entre a tela e o processo principal: a tela só consegue mandar pedidos para a
// API fiscal embutida (nenhum acesso a arquivos, Node ou ao certificado).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fiscal", {
  chamar: (pedido) => ipcRenderer.invoke("fiscal:fetch", pedido),
});
