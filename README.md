# Ordem Secreta

Jogo cooperativo para quatro pessoas na mesma rede Wi-Fi. O notebook é o host; cada participante usa seu próprio celular. O servidor sorteia e guarda os números. Antes da confirmação, a tela do host recebe apenas a identidade das cartas, sem valores.

O projeto também pode ser executado em um servidor público para jogadores em redes diferentes. Nesse modo, o host usa um código privado e o QR Code contém um convite exclusivo da partida.

## Requisitos

- Node.js 20.19+ ou 22.12+ (Node.js 24 também funciona)
- Notebook e quatro celulares conectados à mesma rede local
- Navegador atualizado no computador e nos celulares

## Instalar e iniciar

Na pasta do projeto:

```powershell
npm install
npm run dev
```

O comando `npm run dev` inicia Express, Socket.IO e Vite no mesmo endereço, escutando em **0.0.0.0**. Abra `http://localhost:3000/host` no notebook. Depois da instalação, a partida e a comunicação local não precisam de internet.

Para executar a versão compilada:

```powershell
npm run build
npm start
```

## Acesso dos celulares

1. Crie a partida na tela do host.
2. Conecte os celulares ao mesmo Wi-Fi do notebook.
3. Escaneie o QR Code mostrado no lobby ou acesse o endereço `/jogar` indicado na tela, por exemplo `http://192.168.1.100:3000/jogar`.
4. Cada pessoa escolhe seu nome e toca em **Estou pronto**.
5. Quando todos estiverem conectados e prontos, o host inicia a rodada.

O servidor imprime os endereços locais disponíveis no terminal. Se houver mais de um endereço, use o da rede Wi-Fi compartilhada. No Windows, `ipconfig` também mostra o **Endereço IPv4** do adaptador Wi-Fi. Se o celular não abrir a página, confira a rede e autorize o Node.js no firewall do Windows para redes privadas.

## Como jogar

Cada jogador toca em **Sortear minhas cartas** uma vez. Os números aparecem somente em seu celular. A partir do tema e da escala de 0 a 100, cada pessoa descreve suas duas cartas verbalmente sem revelar os números. O host arrasta as oito cartas para a ordem escolhida e clica em **Confirmar ordem**. As cartas viram em sequência e o resultado mostra a ordem escolhida, a correta e as posições certas.

Após o resultado, **Jogar novamente** inicia outra rodada mantendo os jogadores. **Alterar tema** volta ao lobby com a edição aberta. **Voltar ao lobby** exige que todos marquem prontidão novamente. **Encerrar partida** libera uma nova partida.

## Porta e reinício

Por padrão a porta é `3000`. Para usar outra porta no PowerShell:

```powershell
$env:PORT=3001
npm run dev
```

Nesse caso, use `http://localhost:3001/host` e o endereço `/jogar` exibido na tela. Para reiniciar completamente a partida, clique em **Encerrar partida** ou pare o servidor com `Ctrl+C` e inicie novamente. O estado da rodada fica na memória do servidor: atualizar o navegador ou reconectar um celular não apaga a rodada, mas reiniciar o processo do servidor começa uma partida nova.

## Verificação

```powershell
npm test
npm run build
```

Os testes cobrem sorteio sem repetição, sigilo dos valores no estado público, retomada de sessão, validação da ordem e resultado. Para conferir a comunicação em aparelhos reais, abra o host no notebook e entre com quatro celulares na mesma rede.

Com `npm run dev` aberto em outro terminal, `npm run test:integration` simula uma partida com quatro conexões e verifica a reconexão de um jogador. Esse teste cria uma partida no servidor em execução; reinicie o servidor para voltar ao estado inicial.

## Publicar no Render

O arquivo [`render.yaml`](render.yaml) configura um Web Service com Node.js, build, inicialização e teste de saúde. Para publicar:

1. Envie os arquivos do projeto para um repositório GitHub. A pasta `node_modules`, o build `dist` e arquivos `.env` são ignorados pelo Git.
2. No Render, crie um **Blueprint** a partir desse repositório. O serviço será configurado pelo `render.yaml`.
3. Quando solicitado, defina `HOST_CODE` com um código **exclusivo de pelo menos 12 caracteres**. Não coloque esse valor no repositório.
4. Após o deploy, abra `https://SEU-ENDERECO.onrender.com/host`, informe o código e crie a partida.
5. Envie aos jogadores somente o link ou QR Code mostrado no lobby. Ele já terá o convite da partida e poderá ser aberto de qualquer rede.

Para testar o modo público no próprio computador, defina `APP_MODE=public` e `HOST_CODE` antes de `npm start`. O código do host não é enviado no link dos jogadores. Cada partida admite quatro nomes e um único host.

**Limite do plano gratuito:** o jogo ainda guarda a rodada na memória do processo. Uma reinicialização do serviço apaga a partida, e o plano gratuito do Render pode suspender ou reiniciar o serviço. Para uma sessão importante, use um serviço com execução contínua ou mantenha o notebook como servidor local. Mesmo hospedado, cada celular precisa de internet para se conectar.
