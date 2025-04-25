const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const sessionStore = new Map();
const validKeys = new Set(["yourkey", "yourkey", "yourkey"]);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const usedIDs = new Set(); // Pour suivre les IDs utilisés

function generateUniqueID() {
  let id;
  do {
    id = crypto.randomBytes(4).toString("hex"); // ex: 'a1b2c3d4'
  } while (usedIDs.has(id));
  return id;
}

wss.on("connection", (ws) => {
  console.log("✅ Nouveau client connecté");
  ws.myName="";

  let stage = 0; // 0: attente 'probe2', 1: attente '5', 2: authentifié 3: autre page

  ws.on("message", (message) => {
    const msg = message.toString();
    console.log("📨 Message reçu :", msg);
    if (stage === 0 && msg.startsWith("connect:")) {
      const cookie = msg.split(":")[1];
      const session = sessionStore.get(cookie);

      if (!session) {
        console.log("❌ Cookie invalide");
        ws.send("error:connect:invalidsession");
        ws.close();
        return;
      }

      const now = Date.now();
      const sessionAge = now - session.time;
      const expiration = 10 * 60 * 1000; // 10 minutes en millisecondes

      if (sessionAge > expiration) {
        console.log("⌛ Session expirée");
        sessionStore.delete(cookie); // Nettoyage (optionnel mais propre)
        ws.send("error:connect:sessionexpired");
        ws.close();
        return;
      }

      // Restaurer la session
      ws.userid = session.id;
      ws.author = session.author;
      usedIDs.add(ws.userid);
      if (session.new_user === "true") {
        ws.send(`alert:Bienvenue ${session.name} sur chat websocket !`);
      }
      stage = 3;

      // Charger le fichier profil_user.json
      const fs = require("fs");
      const path = require("path");

      const authorFile = path.join(__dirname, "data", `${ws.author}.json`);
      const baseFile = path.join(__dirname, "data", "base.json");

      fs.readFile(authorFile, "utf-8", (err, data) => {
        if (err) {
          console.log(
            `📁 Fichier ${ws.author}.json introuvable, envoi de base.json`
          );
          fs.readFile(baseFile, "utf-8", (err2, baseData) => {
            if (err2) {
              console.log("❌ Erreur lecture base.json");
              ws.send("error:filenotfound:filedata");
            } else {
              ws.send(`filedata:${baseData}`);
            }
          });
        } else {
          console.log(`📁 Envoi du fichier ${ws.author}.json`);
          ws.send(`filedata:${data}`);
        }
      });

      const profilPath = path.join(__dirname, "data_user", "profil_user.json");

      fs.readFile(profilPath, "utf-8", (err, profilData) => {
        let profils = {};
        if (!err) {
          try {
            profils = JSON.parse(profilData);
          } catch (e) {
            console.log("❌ Erreur parsing profil_user.json :", e);
          }
        } else {
          console.log("❌ Erreur lecture profil_user.json :", err);
        }

        ws.myName = session.name;
        ws.myProfil = profils[ws.myName] || "none";

        // 1. Envoi du profil personnel
        ws.send(`your_profil[name:${ws.myName},profil:${ws.myProfil}]`);

        // 2. Envoi des autres profils
        const autresProfils = {};
        for (const [nom, profil] of Object.entries(profils)) {
          if (nom !== ws.myName) {
            autresProfils[nom] = profil;
          }
        }

        ws.send(`user_profil:${JSON.stringify(autresProfils)}`);
      });
      ws.chat = {};
      ws.chat.actualchat = "-all-";

      ws.send(ws.author);
      ws.send(ws.userid);
      ws.send(session.name);
      ws.send(session.pasword);
      //ws.send(alert:Bienvenue ${session.name} sur chat websocket !)
    }

    if (stage === 0 && msg === "probe2") {
      ws.send("probe3");
      stage = 1;
    } else if (stage === 1 && msg === "5") {
      console.log("🔐 Client authentifié");
      stage = 2;

      // 🔑 Générer un ID unique et l’envoyer
      const uid = generateUniqueID();
      usedIDs.add(uid);
      ws.userid = uid; // Stocker sur le client
      ws.send(`userid:${uid}`);
      console.log(`🆔 ID assigné au client : ${uid}`);
    } else if (stage === 1) {
      console.log("❌ Protocole invalide, fermeture...");
      ws.close();
    } else if (stage === 2) {
      if (!ws.author) {
        // Attente du message d'auth
        const authMatch = msg.match(/\[userid:(.+?)\],\[author:(.+?)\]/);
        if (authMatch) {
          const receivedId = authMatch[1];
          const receivedKey = authMatch[2];

          if (receivedId !== ws.userid || !validKeys.has(receivedKey)) {
            ws.send("error:authorerror");
            console.log("❌ Auth échouée : mauvais ID ou clé");
            return ws.close();
          }

          ws.author = receivedKey; // Authentifié
          console.log(
            `✅ Client ${ws.userid} authentifié avec la clé "${receivedKey}"`
          );

          const fs = require("fs");
          const path = require("path");

          const authorFile = path.join(__dirname, "data", `${ws.author}.json`);
          const baseFile = path.join(__dirname, "data", "base.json");

          fs.readFile(authorFile, "utf-8", (err, data) => {
            if (err) {
              console.log(
                `📁 Fichier ${ws.author}.json introuvable, envoi de base.json`
              );
              fs.readFile(baseFile, "utf-8", (err2, baseData) => {
                if (err2) {
                  console.log("❌ Erreur lecture base.json");
                  ws.send("error:filenotfound:filedata");
                } else {
                  ws.send(`filedata:${baseData}`);
                }
              });
            } else {
              console.log(`📁 Envoi du fichier ${ws.author}.json`);
              ws.send(`filedata:${data}`);
            }
          });
        } else {
          if (msg === "2") {
            ws.send("3");
          } else {
            ws.send("error:authorplease");
          }
        }
      } else {
        if (msg === "2") {
          ws.send("3");
        } else {
          console.log(`📦 (${ws.userid}) Message libre :, msg`);
          ws.send("message reçu !");
          if (msg.startsWith("server[id:") && msg.includes(",pasword:")) {
            const match = msg.match(/server\[id:(.+?),pasword:(.+?)\]/);
            if (match) {
              const inputId = match[1];
              const inputPass = match[2];

              const fs = require("fs");
              const path = require("path");

              const userFile = path.join(__dirname, "data_user", "user.json");

              fs.readFile(userFile, "utf-8", (err, fileData) => {
                if (err) {
                  console.log("❌ Erreur lecture user.json :", err);
                  ws.send("server[acces:false]");
                  return;
                }

                let users = {};
                try {
                  users = JSON.parse(fileData);
                } catch (parseErr) {
                  console.log("❌ Erreur parsing user.json :", parseErr);
                  ws.send("server[acces:false]");
                  return;
                }

                if (users[inputId]) {
                  // L'utilisateur existe déjà
                  if (users[inputId] === inputPass) {
                    console.log(
                      `🔓 Accès autorisé pour l'utilisateur ${inputId}`
                    );
                    ws.send("server[acces:true]");

                    const cookie = crypto.randomBytes(8).toString("hex"); // 16 caractères
                    sessionStore.set(cookie, {
                      id: ws.userid,
                      author: ws.author,
                      name: inputId,
                      pasword: inputPass,
                      new_user: "false",
                      time: Date.now(),
                    });

                    setTimeout(() => {
                      ws.send(
                        `server_new[link:testwebsocketconnect.html,cookie:${cookie}]`
                      ); //change link ----------------
                    }, 100); // petite attente pour que le client ait le temps
                  } else {
                    console.log("🚫 Mauvais mot de passe pour ${inputId}");
                    ws.send("server[acces:false]");
                  }
                } else {
                  // Nouvel utilisateur → enregistrer
                  if (inputPass.length < 4 || inputPass.includes(",") || inputPass.includes(":")) {
                    ws.send("server[acces:none]");
                    console.log("pasword invalide");
                    return;
                  }
                  users[inputId] = inputPass;
                  fs.writeFile(
                    userFile,
                    JSON.stringify(users, null, 2),
                    (writeErr) => {
                      if (writeErr) {
                        console.log(
                          "❌ Erreur d'écriture user.json :",
                          writeErr
                        );
                        ws.send("server[acces:false]");
                      } else {
                        console.log(
                          `🆕 Nouvel utilisateur enregistré : ${inputId}`
                        );
                        ws.send("server[acces:true]");
                        ws.send("server[new]");
                        const cookie = crypto.randomBytes(8).toString("hex"); // 16 caractères
                        sessionStore.set(cookie, {
                          id: ws.userid,
                          author: ws.author,
                          name: inputId,
                          pasword: inputPass,
                          new_user: "true",
                          time: Date.now(),
                        });

                        setTimeout(() => {
                          ws.send(
                            `server_new[link:testwebsocketconnect.html,cookie:${cookie}]`
                          ); //change link ----------------
                        }, 100); // petite attente pour que le client ait le temps

                        // Chemin vers profil_user.json
                        const profileFile = path.join(
                          __dirname,
                          "data_user",
                          "profil_user.json"
                        );

                        // Lire le fichier profil_user.json
                        fs.readFile(
                          profileFile,
                          "utf-8",
                          (errProfile, profileData) => {
                            let profiles = {};

                            if (!errProfile) {
                              try {
                                profiles = JSON.parse(profileData);
                              } catch (e) {
                                console.log(
                                  "⚠️ Erreur parsing profil_user.json :",
                                  e
                                );
                              }
                            }

                            // Ajouter l'utilisateur si non présent
                            if (!profiles[inputId]) {
                              profiles[inputId] = "none";
                            }

                            // Écrire le fichier avec la nouvelle entrée
                            fs.writeFile(
                              profileFile,
                              JSON.stringify(profiles, null, 2),
                              (writeProfileErr) => {
                                if (writeProfileErr) {
                                  console.log(
                                    "❌ Erreur d'écriture profil_user.json :",
                                    writeProfileErr
                                  );
                                } else {
                                  console.log(
                                    `📁 profil_user.json mis à jour pour ${inputId}`
                                  );
                                }
                              }
                            );
                          }
                        );
                      }
                    }
                  );
                }
              });
            } else {
              ws.send("server[acces:false]");
            }
          }
        }
      }
    } else if (stage === 3) {
      if (msg === "2") {
        ws.send("3");
      } else if (msg.startsWith("change_profil:")) {
        const newProfil = msg.slice("change_profil:".length).trim();
        if (!newProfil || !ws.myName) return;

        const fs = require("fs");
        const path = require("path");

        const profilPath = path.join(
          __dirname,
          "data_user",
          "profil_user.json"
        );

        fs.readFile(profilPath, "utf-8", (err, data) => {
          if (err) {
            console.log("❌ Erreur lecture profil_user.json");
            ws.send("alert:error:profil:update:read");
            return;
          }

          let profils;
          try {
            profils = JSON.parse(data);
          } catch (e) {
            console.log("❌ JSON invalide dans profil_user.json");
            ws.send("alert:error:profil:update:invalidjson");
            return;
          }

          profils[ws.myName] = newProfil; // Mise à jour

          fs.writeFile(
            profilPath,
            JSON.stringify(profils, null, 2),
            "utf-8",
            (err2) => {
              if (err2) {
                console.log("❌ Erreur écriture profil_user.json");
                ws.send("alert:error:profil:update:write");
              } else {
                ws.myProfil = newProfil; // Mise à jour mémoire
                ws.send(`new_profil:${ws.myProfil}`);
                console.log(
                  `📝 Profil de ${ws.myName} mis à jour : ${ws.myProfil}`
                );
              }
            }
          );
        });
      } else if (msg === "get_chat:-all-") {
        ws.chat = ws.chat || {};
        ws.chat.actualchat = "-all-";
        console.log(`📥 ${ws.myName} a demandé l'historique du chat -all-`);

        const fs = require("fs");
        const path = require("path");
        const chatPath = path.join(__dirname, "chat_all", "chat.json");

        fs.readFile(chatPath, "utf-8", (err, data) => {
          if (err) {
            console.log("❌ Erreur lecture chat.json :", err);
            ws.send("error:get:chatfile");
          } else {
            ws.send(`set_message:${data}`);
          }
        });
      } else if (
        msg.startsWith("new_message:") &&
        ws.chat?.actualchat === "-all-"
      ) {
        const messageContent = msg.slice("new_message:".length).trim();
        const time = Date.now();

        const fs = require("fs");
        const path = require("path");
        const chatPath = path.join(__dirname, "chat_all", "chat.json");

        fs.readFile(chatPath, "utf-8", (err, fileData) => {
          let chatHistory = {};
          if (!err) {
            try {
              chatHistory = JSON.parse(fileData);
            } catch (e) {
              console.log("❌ Erreur parsing chat.json :", e);
              return;
            }
          }

          const ids = Object.keys(chatHistory).map(Number);
          const nextId = ids.length ? Math.max(...ids) + 1 : 1;

          chatHistory[nextId] = {
            message: messageContent,
            name: ws.myName || "inconnu",
            time: time,
          };

          fs.writeFile(
            chatPath,
            JSON.stringify(chatHistory, null, 2),
            "utf-8",
            (err2) => {
              if (err2) {
                console.log("❌ Erreur écriture chat.json :", err2);
              } else {
                console.log(
                  `💬 Nouveau message de ${ws.myName} enregistré (ID ${nextId})`
                );
              }
            }
          );

          // Broadcast signal "update_message:-all-" pour rafraîchir
          wss.clients.forEach((client) => {
            if (
              client.readyState === WebSocket.OPEN &&
              client.chat?.actualchat === "-all-"
            ) {
              client.send("update_message:-all-");
            }
          });
        });
      } else if (msg.startsWith("get_chat:")) {
        const chatTarget = msg.slice("get_chat:".length).trim();
        ws.chat = ws.chat || {};
        ws.chat.actualchat = chatTarget;

        console.log(
          `📥 ${ws.myName} a demandé l'historique du chat avec ${chatTarget}`
        );

        const fs = require("fs");
        const path = require("path");

        if (chatTarget === "-all-") {
          const chatPath = path.join(__dirname, "chat_all", "chat.json");
          fs.readFile(chatPath, "utf-8", (err, data) => {
            if (err) {
              ws.send("error:get:chatfile");
            } else {
              ws.send(`set_message:${data}`);
            }
          });
        } else {
          const baseDir = path.join(__dirname, "chat");
          const filenames = [
            `[${ws.myName},${chatTarget}].json`,
            `[${chatTarget},${ws.myName}].json`,
          ];

          const existingFile = filenames.find((file) =>
            fs.existsSync(path.join(baseDir, file))
          );
          const fileToUse = existingFile || filenames[0]; // default to [myName, target]

          const chatPath = path.join(baseDir, fileToUse);

          fs.readFile(chatPath, "utf-8", (err, data) => {
            if (err) {
              // File doesn't exist or unreadable, send empty history
              ws.send(`set_message:{}`);
            } else {
              ws.send(`set_message:${data}`);
            }
          });
        }
      } else if (msg.startsWith("new_message:")) {
        const messageContent = msg.slice("new_message:".length).trim();
        const time = Date.now();
        const fs = require("fs");
        const path = require("path");

        if (ws.chat?.actualchat === "-all-") {
          const chatPath = path.join(__dirname, "chat_all", "chat.json");

          fs.readFile(chatPath, "utf-8", (err, fileData) => {
            let chatHistory = {};
            if (!err) {
              try {
                chatHistory = JSON.parse(fileData);
              } catch (e) {
                return;
              }
            }

            const ids = Object.keys(chatHistory).map(Number);
            const nextId = ids.length ? Math.max(...ids) + 1 : 1;

            chatHistory[nextId] = {
              message: messageContent,
              name: ws.myName || "inconnu",
              time: time,
            };

            fs.writeFile(
              chatPath,
              JSON.stringify(chatHistory, null, 2),
              "utf-8",
              (err2) => {
                if (!err2) {
                  wss.clients.forEach((client) => {
                    if (
                      client.readyState === WebSocket.OPEN &&
                      client.chat?.actualchat === "-all-"
                    ) {
                      client.send("update_message:-all-");
                    }
                  });
                }
              }
            );
          });
        } else {
          const target = ws.chat.actualchat;
          const baseDir = path.join(__dirname, "chat");
          const filenames = [
            `[${ws.myName},${target}].json`,
            `[${target},${ws.myName}].json`,
          ];

          const existingFile = filenames.find((file) =>
            fs.existsSync(path.join(baseDir, file))
          );
          const fileToUse = existingFile || filenames[0];
          const chatPath = path.join(baseDir, fileToUse);

          fs.readFile(chatPath, "utf-8", (err, fileData) => {
            let chatHistory = {};
            if (!err) {
              try {
                chatHistory = JSON.parse(fileData);
              } catch (e) {
                console.log("Erreur parsing JSON", e);
                return;
              }
            }

            const ids = Object.keys(chatHistory).map(Number);
            const nextId = ids.length ? Math.max(...ids) + 1 : 1;

            chatHistory[nextId] = {
              message: messageContent,
              name: ws.myName || "inconnu",
              time: time,
            };

            fs.writeFile(
              chatPath,
              JSON.stringify(chatHistory, null, 2),
              "utf-8",
              (err2) => {
                if (!err2) {
                  console.log(
                    `📨 Message privé entre ${ws.myName} et ${target} enregistré`
                  );

                  wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                      if (
                        client.myName === ws.myName ||
                        client.myName === target
                      ) {
                        client.send(`update_message:${target}`);
                        client.send(`update_message:${ws.myName}`);
                      }
                    }
                  });
                }
              }
            );
          });
        }
      }

      //complette -----------------------------------------------------------------------------------------------
    }
  });

  ws.on("close", () => {
    if (ws.userid) {
      usedIDs.delete(ws.userid); // Libérer l'ID
      console.log(`♻️ ID libéré : ${ws.userid}`);
    }
    console.log("❌ Client déconnecté");
  });
});

app.get("/", (req, res) => {
  res.send("🌐 Serveur WebSocket by argentrocher !");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});
