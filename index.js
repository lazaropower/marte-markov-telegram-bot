const MarkovGen = require('markov-generator');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const mongooseFieldEncryption = require("mongoose-field-encryption").fieldEncryption;
var pjson = require('./package.json');
const gTTS = require('gtts');
const fs = require('fs');

require('dotenv').config();

console.log(`Yeeeeeha! Soy Manolo Callejas - v${pjson.version}`);

const bot = new TelegramBot(process.env.TOKEN, {polling: true});

const commands = [
    {
        command: '/habla',
        description: 'Mando un mensaje'
    },
    {
        command: '/audio',
        description: 'Mando un audio'
    },
    {
        command: '/comandos',
        description: 'Lista de comandos'
    },
    {
        command: '/stats',
        description: 'Mando el número de mensajes aprendidos'
    },
    {
        command: '/about',
        description: 'Te doy información básica sobre mi'
    },{
        command: '/eliminar',
        description: 'Olvidaré todos los mensajes aprendidos en el grupo'
    },{
        command: '/arreglarme',
        description: 'Usa este comando si dejo de mandar mensajes automáticos'
    },{
        command: '/frecuencia',
        description: 'Establezco la frecuencia con la que hablo (por defecto cada 10 mensajes)'
    },{
        command: '/sticker',
        description: 'Mando un sticker'
    },{
        command: '/discurso',
        description: 'Genero un discurso'
    },{
        command: '/cita',
        description: 'Genero una cita'
    },{
        command: '/aprender',
        description: 'Aprendo un archivo .txt'
    }
];

bot.setMyCommands(commands);

console.log("Vale, veamos lo que he aprendido...")

mongoose.connect(`mongodb+srv://${process.env.DB_HOST}/manolobot`, {useNewUrlParser: true, useUnifiedTopology: true})
.then(() => console.log("Interesting..."))
.catch(() => console.log("Whoops... Something went wrong..."));

const MessageSchema = new mongoose.Schema({ 
    text: String, 
    chatId: Number 
});

MessageSchema.plugin(mongooseFieldEncryption, { fields: ["text"], secret: process.env.ENCRYPT_KEY });

const Message = new mongoose.model('Message', MessageSchema);

const Config = new mongoose.model('Config', {
    chatId: Number,
    frequency: Number
})

const Sticker = new mongoose.model('Sticker', {
    chatId: Number,
    file_id: String,
    count: Number
})

const generateMarkovMessage = async (chatId) => {
    const messages = await Message.find({chatId});
    const input = messages.map(m => {
        return m.text;
    });
    let markov = new MarkovGen({
        input: input,
        minLength: 4
    });
    return markov.makeChain().replace(new RegExp(`@${process.env.TELEGRAM_BOT_USER}`, 'g'), '');
}

const sendMarkovMessage = (chatId) => {
    generateMarkovMessage(chatId)
    .then(text => {
        bot.sendMessage(chatId, text);
    })
    .catch(e => {
        bot.sendMessage(chatId, 'Lo siento, necesito aprender más');
    });
}

const sendMarkovMessageAsAudio = (chatId, msgId) => {
    generateMarkovMessage(chatId)
    .then(text => {
        var gtts = new gTTS(text, 'es');
        const path = `audios/Manolo ${chatId}-${msgId}.mp3`;
        gtts.save(path, function (err, result){
            if(err) {
                bot.sendMessage(chatId, 'Lo siento, algo ha ido mal. Por favor, prueba de nuevo con /audio');
                return;
            }
            bot.sendAudio(chatId, path, {title: 'Manolo'})
                .catch(err => {
                    bot.sendMessage(chatId, 'Lo siento, algo ha ido mal. Por favor, prueba de nuevo con /audio');
                })
                .finally(() => {
                    fs.unlink(path, () => {
                        return;
                    });
                });
        });
    })
    .catch(e => {
        bot.sendMessage(chatId, 'Lo siento, necesito aprender más');
    });
}

const sendSticker = async (chatId) => {
    const stickers = await Sticker.find({chatId});
    if (stickers.length > 0){
        const rand = Math.floor(Math.random() * stickers.length);
        bot.sendSticker(chatId, stickers[rand].file_id);
        return true;
    }
    return false;
}

const generateSpeech = async (chatId, length) => {
    let speech = '';
    try{
        for (let i = 0; i < length; i++){
            const newPhrase = await generateMarkovMessage(chatId);
            speech = speech + newPhrase.replace(new RegExp(/\./, 'g'), '') + '. ';
        }
        return speech;
    } catch(e) {
        return speech.length > 0 ? speech : 'Lo siento, necesito aprender más'; 
    }
}

bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/') && !isRemoveOption(msg)){
        Message.create({
            text: msg.text.replace(new RegExp(`@${process.env.TELEGRAM_BOT_USER}`, 'g'), ''),
            chatId: msg.chat.id
        }, async (err, message) => {
            if (!err) {
                const config = await Config.findOne({chatId: message.chatId})
                const messages = await Message.find({chatId: message.chatId});
                if (messages.length === 666){
                    bot.sendMessage(message.chatId, 'He aprendido 666 mensajes 😈')
                } else {
                    if (messages.length % (config ? config.frequency : 10) === 0) {
                        const rand = Math.random();
                        if (rand > 0.15){
                            sendMarkovMessage(message.chatId);
                        } else {
                            const sent = await sendSticker(msg.chat.id);
                            if (!sent){
                                sendMarkovMessage(message.chatId);
                            }
                        }
                    }
                }
            }
        });
    }
})

bot.onText(/\/habla/, (msg, match) => {
    sendMarkovMessage(msg.chat.id);
});

bot.onText(/\/audio/, (msg, match) => {
    sendMarkovMessageAsAudio(msg.chat.id, msg.message_id);
});

bot.onText(/\/speech/, async (msg, match) => {
    const length = Math.floor(Math.random() * 10);
    const speech = await generateSpeech(msg.chat.id, length);
    bot.sendMessage(msg.chat.id, speech);
})

bot.onText(/\/stats/, async (msg, match) => {
    const messages = await Message.find({chatId: msg.chat.id});
    bot.sendMessage(msg.chat.id, `He aprendido ${messages.length} mensajes`);
});

bot.onText(/\/eliminar/, async (msg, match) => {
    bot.sendMessage(msg.chat.id, '¿Estás seguro de que deseas eliminar todos los mensajes?', {
        reply_markup: {
            keyboard: [["Yes"], ["No"]],
            remove_keyboard: true
        }
    })
})

const isRemoveOption = (msg) => {
    return msg.reply_to_message && msg.reply_to_message.from.username === process.env.TELEGRAM_BOT_USER 
    && msg.reply_to_message.text === '¿Estás seguro de que quieres eliminar todos los mensajes aprendidos?';
}

bot.onText(/^Yes$|^No$/, async (msg, match) => {
    if (isRemoveOption(msg)){
        if (msg.text === 'Yes'){
            let deleted = await Message.deleteMany({chatId: msg.chat.id});
            deleted = deleted && await Sticker.deleteMany({chatId: msg.chat.id});
            bot.sendMessage(msg.chat.id, 
                deleted ? 'Mensajes eliminados correctamente' : 'Algo fue mal, inténtalo de nuevo más tarde', {
                reply_markup: {
                    remove_keyboard: true    
                }
            });
        }
        if (msg.text === 'No'){
            bot.sendMessage(msg.chat.id, 'Bien! Me ha costado un cojón aprender tantos mensajes...', {
                reply_markup: {
                    remove_keyboard: true    
                }
            });
        }
    }
})

bot.onText(/\/about/, async (msg, match) => {
    bot.sendMessage(msg.chat.id, `Yeeeha, soy Manolo Callejas, tu camarero de confianza.`,
    {
        parse_mode: 'HTML'
    });
});

bot.onText(new RegExp(`@${process.env.TELEGRAM_BOT_USER}`, 'g'), async (msg, match) => {
    if (!msg.text.startsWith('/') && !isRemoveOption(msg)) {
        generateMarkovMessage(msg.chat.id)
        .then((message) => {
            bot.sendMessage(msg.chat.id, message, {
                reply_to_message_id: msg.message_id
            });
        })
        .catch(e => {
            bot.sendMessage(msg.chat.id, 'Lo siento, necesito aprender más', {
                reply_to_message_id: msg.message_id
            });
        })
    }
});

bot.onText(/\/arreglarme/, (msg, match) => {
    bot.sendMessage(msg.chat.id, 'Aféitame del grupo y añádeme otra vez..'
        + ' Recordaré todos los mensajes que he aprendido');
});

bot.onText(/\/frecuencia/, async (msg, match) => {
    const param = match.input.split(/\s+/)[1];
    const config = await Config.findOne({chatId: msg.chat.id});
    if (!param){
        bot.sendMessage(msg.chat.id, `La frecuencia está establecida a ${config ? config.frequency : 10}`);
    } else {
        if (!isNaN(param) && param > 0){
            Config.update({chatId: msg.chat.id}, {$set: {frequency: param}}, {upsert: true}, (err, config) => {
                if (!err) {
                    bot.sendMessage(msg.chat.id, `Frecuencia establecida a ${param}`);
                } else {
                    bot.sendMessage(msg.chat.id, 'Por favor, inténtalo de nuevo');
                }
            })
        } else {
            bot.sendMessage(msg.chat.id, `Parámetro inválido. Envía /frecuencia <frecuencia de mensajes>`);
        }
        
    }
});

bot.on('sticker', (msg) => {
    Sticker.update({chatId: msg.chat.id, file_id: msg.sticker.file_id},
        {$inc: {count: 1}},
        {upsert: true}, (err, st) => {
            console.log(err ? 'Error aprendiendo sticker' : 'Sticker aprendido');
        });
})

bot.on('dice', async (msg) => {
    const speech = await generateSpeech(msg.chat.id, msg.dice.value);
    bot.sendMessage(msg.chat.id, speech);
})

bot.onText(/\/sticker/, async (msg) => {
    const sent = await sendSticker(msg.chat.id)
    if (!sent) {
        bot.sendMessage(msg.chat.id, 'Lo siento, primero necesito aprender stickers. Por favor, envíame uno')
    }
})

bot.onText(/^\/cita/, async (msg, match) => {
    let author = match.input.replace(/^\/quote/, '');
    author = author.replace(`@${process.env.TELEGRAM_BOT_USER}`, '');
    if (!author){
        bot.sendMessage(msg.chat.id, 'Por favor, escribe /cita <autor> para generar una cita\n\n'
            + 'Por ejemplo:\n\n/cita Obi-Wan Kenobi\n\n/cita Albert Einstein\n\n/cita @<usuario en este grupo>');
    } else {
        author = author.replace(/\s+/, '');    
        const message = await generateMarkovMessage(msg.chat.id);
        bot.sendMessage(msg.chat.id, `"${message}"\n\n-${author}`)
    }
})

bot.onText(/^\/aprender/, async (msg, match) => {
    const chatId = msg.chat.id;

    if (!msg.reply_to_message) {
        bot.sendMessage(chatId, 'Debes citar un archivo .txt o enviarme uno.');
        return;
    }

    const document = msg.reply_to_message.document;

    if (document) {
        if (!isTxtFile(document)) {
            bot.sendMessage(msg.chat.id, 'Lo siento, el fichero tiene que estar en formato .txt.');
            return;
        }
        askToLearnMessage(msg.reply_to_message);
    }
})

bot.on('document', async (msg) => {
    if (!isTxtFile(msg.document)) {
        bot.sendMessage(msg.chat.id, 'Lo siento, el fichero tiene que estar en formato .txt.');
        return;
    }
    askToLearnMessage(msg);
});

bot.on('callback_query', (query) => {
    console.log(query);
    const chatId = query.message.chat.id;
    switch (query.data) {
        case 'data1':
            bot.sendMessage(chatId, 'Perfecto, aprendiendo...');
            learnText(chatId, query.message.reply_to_message.document)
            break;
        case 'data2':
            bot.sendMessage(chatId, 'Vale, quizá la próxima vez.');
            break;
        default:
            break;
    }
    // Remove inline keyboard
    bot.deleteMessage(chatId, query.message.message_id);
});

const learnText = (chatId, document) => {
    const stream = bot.getFileStream(document.file_id);
    stream.on('data', (data) => {
        const chunk = data.toString();
        const result = chunk.match(/[^.?!]+[.!?]+[\])'"`’”]*/g);
        result.forEach(element => {
            Message.create({
                text: element.replace(new RegExp(`@${process.env.TELEGRAM_BOT_USER}`, 'g'), ''),
                chatId: chatId
            });
        });
    });
    bot.sendMessage(chatId, '¡Texto aprendido!');
}

const isTxtFile = (document) => {
    const extension = document.file_name.split('.').pop();
    if (extension !== 'txt')
        return false;
    return true;
}

const askToLearnMessage = (msg) => {
    const options = {
        'reply_to_message_id': msg.message_id,
        'reply_markup': {
            'inline_keyboard': [
                [
                    {
                        text: 'Yes',
                        callback_data: 'data1'
                    }
                ],
                [
                    {
                        text: 'No',
                        callback_data: 'data2'
                    }
                ],
            ]
        }
    }

    bot.sendMessage(msg.chat.id, 'Should I learn this text?', options);
}

bot.onText(/\/comandos/, (msg, match) => {
    let text = `Comandos disponibles (v${pjson.version})\n\n`;
    commands.forEach(c => {
        text = text + `${c.command} - ${c.description}\n\n`
    })
    text = text + 'Prueba a enviarme el icono del dado. Te enviaré un discurso random dependiendo del resultado que salga.';
    bot.sendMessage(msg.chat.id, text);
})

bot.on('polling_error', (e) => console.log(e))