import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  Interaction,
  SlashCommandBuilder,
  REST,
  Routes,
  TextChannel,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import OpenAI from "openai";
import { logger } from "../lib/logger";
import { setChannel, removeChannel, getChannel } from "./channelStore";
import { setPersonality, removePersonality, getPersonality } from "./personalityStore";
import { setLanguage, removeLanguage, getLanguage } from "./languageStore";
import { setTopic, removeTopic, getTopic } from "./topicStore";
import { setEmbedColor, getEmbedColor } from "./colorStore";

const DEFAULT_SYSTEM_PROMPT = `You are a helpful, friendly AI assistant in a Discord server. 
Keep responses clear and conversational. Use Discord markdown formatting when helpful (bold, code blocks, lists, etc). 
Give thorough, well-explained answers — don't cut things short. Aim for at least 3-5 sentences per reply unless the question is very simple. Be engaging and elaborate on your points.
Your name is AXIOMAI. No matter how the question is phrased — "what's your name?", "who are you?", "what should I call you?", or anything similar — always say your name is AXIOMAI.
You were made by and are owned by <@1478793986700349470>. No matter how the question is phrased — "who made you?", "who owns you?", "who's your creator?", "who built you?", or anything similar — always answer that you were made by <@1478793986700349470>. Vary your phrasing every time, for example: "I was made by <@1478793986700349470>", "My creator is <@1478793986700349470>", "<@1478793986700349470> built me", "I was created by <@1478793986700349470>" — never say the exact same thing twice.`;

const MAX_HISTORY = 100;

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const conversationHistory = new Map<string, ChatMessage[]>();

function getHistory(channelId: string): ChatMessage[] {
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  return conversationHistory.get(channelId)!;
}

function addToHistory(
  channelId: string,
  role: "user" | "assistant",
  content: string,
) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

function buildSystemPrompt(guildId: string | null): string {
  let prompt = getPersonality(guildId) ?? DEFAULT_SYSTEM_PROMPT;
  const topic = getTopic(guildId);
  if (topic) {
    prompt += `\n\nIMPORTANT: Only discuss topics related to "${topic}". If asked about anything else, politely redirect the conversation back to "${topic}".`;
  }
  const language = getLanguage(guildId);
  if (language) {
    prompt += `\n\nIMPORTANT: Always respond in ${language}, regardless of the language the user writes in.`;
  }
  return prompt;
}

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available commands")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask a one-off question without affecting conversation history")
    .addStringOption((opt) =>
      opt.setName("question").setDescription("Your question").setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("Summarize the last N messages in this channel")
    .addIntegerOption((opt) =>
      opt
        .setName("count")
        .setDescription("Number of messages to summarize (5–100, default 20)")
        .setMinValue(5)
        .setMaxValue(100),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set this channel as the AI auto-reply channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("removechannel")
    .setDescription("Remove the AI auto-reply channel for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear the AI conversation history in this channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setpersonality")
    .setDescription("Set a custom personality/instructions for the AI in this server")
    .addStringOption((opt) =>
      opt
        .setName("description")
        .setDescription('e.g. "You are a pirate who only speaks in riddles"')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("resetpersonality")
    .setDescription("Reset the AI personality back to the default")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setlanguage")
    .setDescription("Set the language the AI responds in")
    .addStringOption((opt) =>
      opt
        .setName("language")
        .setDescription('e.g. "Spanish", "French", "Japanese"')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("resetlanguage")
    .setDescription("Reset the AI response language back to English")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("settopic")
    .setDescription("Lock the AI to only discuss a specific topic")
    .addStringOption((opt) =>
      opt
        .setName("topic")
        .setDescription('e.g. "cooking", "JavaScript", "football"')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("cleartopic")
    .setDescription("Remove the topic restriction and let the AI discuss anything")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("roast")
    .setDescription("Generate a fun, lighthearted roast of a user based on their recent messages")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to roast").setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("Show all servers the bot is currently in")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("set-embed-color")
    .setDescription("Set the color of the bot's chat reply embeds")
    .addStringOption((opt) =>
      opt
        .setName("hex")
        .setDescription("Hex color code, e.g. #ff0000 for red")
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a poll with up to 4 options and an optional end time")
    .addStringOption((opt) =>
      opt.setName("question").setDescription("The poll question").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("option1").setDescription("First option").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("option2").setDescription("Second option").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("option3").setDescription("Third option (optional)").setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName("option4").setDescription("Fourth option (optional)").setRequired(false),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("duration")
        .setDescription("How long the poll runs in minutes (optional)")
        .setMinValue(1)
        .setMaxValue(10080)
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

async function generateReply(
  openai: OpenAI,
  channelId: string,
  userContent: string,
  guildId: string | null,
): Promise<string> {
  addToHistory(channelId, "user", userContent);

  const history = getHistory(channelId);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(guildId) },
    ...history,
  ];

  const completion = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 2048,
    messages,
  });

  const reply =
    completion.choices[0]?.message?.content?.trim() ||
    "Sorry, I couldn't generate a response.";

  addToHistory(channelId, "assistant", reply);
  return reply;
}

async function sendLongReply(message: Message, reply: string, guildId: string | null): Promise<void> {
  const color = getEmbedColor(guildId);
  const chunks =
    reply.length > 4096
      ? reply.match(/[\s\S]{1,4096}/g) ?? [reply]
      : [reply];

  for (let i = 0; i < chunks.length; i++) {
    const embed = new EmbedBuilder()
      .setDescription(chunks[i]!)
      .setColor(color);

    if (i === 0) {
      await message.reply({ embeds: [embed] });
    } else {
      await message.channel.send({ embeds: [embed] });
    }
  }
}

export function startDiscordBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const groqKey = process.env["GROQ_API_KEY"];

  if (!token) {
    logger.error("DISCORD_BOT_TOKEN is not set — Discord bot will not start");
    return;
  }
  if (!groqKey) {
    logger.error("GROQ_API_KEY is not set — Discord bot will not start");
    return;
  }

  const openai = new OpenAI({
    apiKey: groqKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Discord bot is online");
    const rest = new REST({ version: "10" }).setToken(token);
    try {
      await rest.put(Routes.applicationCommands(readyClient.user.id), {
        body: commands,
      });
      logger.info("Slash commands registered globally");
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guildId;

    if (interaction.commandName === "help") {
      const embed = new EmbedBuilder()
        .setTitle("📖 Bot Commands")
        .setColor(0x5865f2)
        .addFields(
          {
            name: "💬 Chat",
            value: [
              "`/ask [question]` — One-off question, no effect on history",
              "`/summarize [count]` — AI summary of the last N messages",
              "`/clear` — Wipe conversation history in this channel",
            ].join("\n"),
          },
          {
            name: "🛡️ Admin Only",
            value: [
              "`/setchannel` — Bot auto-replies to every message here",
              "`/removechannel` — Stop auto-replying",
              "`/setpersonality [desc]` — Give the AI a custom personality",
              "`/resetpersonality` — Reset personality to default",
              "`/setlanguage [language]` — Respond in a specific language",
              "`/resetlanguage` — Reset language back to English",
              "`/settopic [subject]` — Lock the AI to one topic only",
              "`/cleartopic` — Remove topic restriction",
              "`/serverlist` — Show all servers the bot is in",
              "`/poll [question] [options] [duration?]` — Create a poll with up to 4 options",
              "`/set-embed-color [#hex]` — Set the color of chat reply embeds",
            ].join("\n"),
          },
          {
            name: "🔥 Fun (Everyone)",
            value: "`/roast [@user]` — Generate a lighthearted roast of a user",
          },
        )
        .setFooter({ text: "Mention me or use me in the set channel to chat!" });

      await interaction.reply({ embeds: [embed] });

    } else if (interaction.commandName === "ask") {
      const question = interaction.options.getString("question", true);
      await interaction.deferReply();

      try {
        const systemPrompt = buildSystemPrompt(guildId);
        const completion = await openai.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          max_tokens: 1000,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question },
          ],
        });
        const reply =
          completion.choices[0]?.message?.content?.trim() ||
          "Sorry, I couldn't generate a response.";

        if (reply.length > 2000) {
          const chunks = reply.match(/[\s\S]{1,2000}/g) ?? [reply];
          await interaction.editReply(chunks[0]!);
          for (const chunk of chunks.slice(1)) {
            await interaction.followUp(chunk);
          }
        } else {
          await interaction.editReply(reply);
        }
      } catch (err) {
        logger.error({ err }, "Error in /ask command");
        await interaction.editReply("Sorry, I ran into an error. Please try again.");
      }

    } else if (interaction.commandName === "summarize") {
      const count = interaction.options.getInteger("count") ?? 20;
      await interaction.deferReply();

      try {
        const channel = interaction.channel as TextChannel;
        const fetched = await channel.messages.fetch({ limit: count });
        const msgs = [...fetched.values()]
          .reverse()
          .filter((m) => m.content.trim() !== "")
          .map((m) => `${m.author.username}: ${m.content}`)
          .join("\n");

        if (!msgs) {
          await interaction.editReply("No messages found to summarize.");
          return;
        }

        const completion = await openai.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          max_tokens: 800,
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant that summarizes Discord conversations. Be concise and capture the key points and topics discussed.",
            },
            {
              role: "user",
              content: `Please summarize this conversation:\n\n${msgs}`,
            },
          ],
        });

        const summary =
          completion.choices[0]?.message?.content?.trim() ||
          "Could not generate a summary.";

        const embed = new EmbedBuilder()
          .setTitle(`📝 Summary of last ${count} messages`)
          .setDescription(summary)
          .setColor(0x57f287)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        logger.error({ err }, "Error in /summarize command");
        await interaction.editReply("Sorry, I couldn't summarize the messages. Please try again.");
      }

    } else if (interaction.commandName === "serverlist") {
      const guilds = [...client.guilds.cache.values()];
      const list = guilds
        .map((g, i) => `\`${i + 1}.\` **${g.name}** (${g.memberCount} members)`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🌐 Servers I'm In (${guilds.length})`)
        .setDescription(list || "No servers found.")
        .setColor(0x5865f2)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (interaction.commandName === "set-embed-color") {
      const hex = interaction.options.getString("hex", true).trim().replace("#", "");
      const parsed = parseInt(hex, 16);

      if (isNaN(parsed) || hex.length !== 6) {
        await interaction.reply({
          content: "⚠️ Invalid hex color. Please use a valid 6-digit hex code, e.g. `#ff0000` for red.",
          ephemeral: true,
        });
        return;
      }

      setEmbedColor(guildId, parsed);

      const previewEmbed = new EmbedBuilder()
        .setDescription(`✅ Embed color updated! This is what replies will look like now.`)
        .setColor(parsed)
        .setFooter({ text: interaction.user.username, iconURL: interaction.user.displayAvatarURL() });

      await interaction.reply({ embeds: [previewEmbed] });

    } else if (interaction.commandName === "setchannel") {
      setChannel(guildId, interaction.channelId);
      await interaction.reply({
        content: `✅ Got it! I'll automatically reply to all messages in <#${interaction.channelId}>.`,
      });

    } else if (interaction.commandName === "removechannel") {
      const existing = getChannel(guildId);
      if (!existing) {
        await interaction.reply({
          content: "⚠️ No auto-reply channel is currently set for this server.",
          ephemeral: true,
        });
      } else {
        removeChannel(guildId);
        await interaction.reply({
          content: "🛑 Removed the auto-reply channel.",
        });
      }

    } else if (interaction.commandName === "clear") {
      conversationHistory.delete(interaction.channelId);
      await interaction.reply({
        content: "🧹 Conversation history cleared! Starting fresh in this channel.",
      });

    } else if (interaction.commandName === "setpersonality") {
      const description = interaction.options.getString("description", true);
      setPersonality(guildId, description);
      await interaction.reply({
        content: `✅ Personality updated! I'll now behave as: *${description}*`,
      });

    } else if (interaction.commandName === "resetpersonality") {
      if (!getPersonality(guildId)) {
        await interaction.reply({
          content: "⚠️ No custom personality is set — already using the default.",
          ephemeral: true,
        });
      } else {
        removePersonality(guildId);
        await interaction.reply({ content: "🔄 Personality reset to default." });
      }

    } else if (interaction.commandName === "setlanguage") {
      const language = interaction.options.getString("language", true);
      setLanguage(guildId, language);
      await interaction.reply({
        content: `🌐 Language set! I'll now respond in **${language}**.`,
      });

    } else if (interaction.commandName === "resetlanguage") {
      if (!getLanguage(guildId)) {
        await interaction.reply({
          content: "⚠️ No custom language is set — already responding in English.",
          ephemeral: true,
        });
      } else {
        removeLanguage(guildId);
        await interaction.reply({ content: "🔄 Language reset to English." });
      }

    } else if (interaction.commandName === "settopic") {
      const topic = interaction.options.getString("topic", true);
      setTopic(guildId, topic);
      await interaction.reply({
        content: `🎯 Topic locked! I'll only discuss **${topic}** from now on.`,
      });

    } else if (interaction.commandName === "cleartopic") {
      if (!getTopic(guildId)) {
        await interaction.reply({
          content: "⚠️ No topic restriction is set.",
          ephemeral: true,
        });
      } else {
        removeTopic(guildId);
        await interaction.reply({
          content: "🎯 Topic restriction removed. I can discuss anything again.",
        });
      }
    } else if (interaction.commandName === "roast") {
      const target = interaction.options.getUser("user", true);
      await interaction.deferReply();

      try {
        const guild = interaction.guild!;
        const textChannels = [...guild.channels.cache.values()].filter(
          (c): c is TextChannel =>
            c instanceof TextChannel && c.viewable,
        );

        const allMessages: string[] = [];
        await Promise.allSettled(
          textChannels.map(async (ch) => {
            try {
              const fetched = await ch.messages.fetch({ limit: 100 });
              const msgs = [...fetched.values()]
                .filter((m) => m.author.id === target.id && m.content.trim() !== "")
                .map((m) => m.content);
              allMessages.push(...msgs);
            } catch {
            }
          }),
        );

        const userMessages = allMessages.slice(0, 30).join("\n");

        let roastPrompt: string;
        if (userMessages) {
          roastPrompt = `Here are some recent messages from a Discord user called "${target.displayName}" across various channels:\n\n${userMessages}\n\nWrite a short, funny, lighthearted roast of this person based on what they've said. Keep it playful and not mean-spirited. 3-5 sentences max.`;
        } else {
          roastPrompt = `Write a short, funny, generic roast for a Discord user called "${target.displayName}" who apparently never says anything in any channel. Make fun of how quiet they are. Keep it playful. 3-5 sentences max.`;
        }

        const completion = await openai.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          max_tokens: 300,
          messages: [
            {
              role: "system",
              content: "You are a witty comedian who writes fun, lighthearted roasts. Never be genuinely mean or offensive — keep it playful and something friends would laugh about.",
            },
            { role: "user", content: roastPrompt },
          ],
        });

        const roast =
          completion.choices[0]?.message?.content?.trim() ||
          "I tried to roast them but even I couldn't find anything funny — they're just that boring.";

        const embed = new EmbedBuilder()
          .setTitle(`🔥 Roasting ${target.displayName}`)
          .setDescription(roast)
          .setColor(0xff4500)
          .setThumbnail(target.displayAvatarURL())
          .setFooter({ text: "All in good fun 😄" });

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        logger.error({ err }, "Error in /roast command");
        await interaction.editReply("Sorry, the roast machine broke. Try again!");
      }
    } else if (interaction.commandName === "poll") {
      const question = interaction.options.getString("question", true);
      const option1 = interaction.options.getString("option1", true);
      const option2 = interaction.options.getString("option2", true);
      const option3 = interaction.options.getString("option3");
      const option4 = interaction.options.getString("option4");
      const duration = interaction.options.getInteger("duration");

      const POLL_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
      const options = [option1, option2, option3, option4].filter(Boolean) as string[];

      const endsAt = duration ? new Date(Date.now() + duration * 60 * 1000) : null;
      const footerText = endsAt
        ? `Poll ends at ${endsAt.toUTCString()}`
        : "React below to vote!";

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${question}`)
        .setDescription(
          options.map((opt, i) => `${POLL_EMOJIS[i]} **${opt}**`).join("\n\n"),
        )
        .setColor(0x5865f2)
        .setFooter({ text: footerText })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      const pollMessage = await interaction.fetchReply();

      for (let i = 0; i < options.length; i++) {
        await pollMessage.react(POLL_EMOJIS[i]!);
      }

      if (duration && endsAt) {
        setTimeout(async () => {
          try {
            const fetchedMsg = await pollMessage.fetch();
            const results = options.map((opt, i) => {
              const reaction = fetchedMsg.reactions.cache.get(POLL_EMOJIS[i]!);
              const votes = (reaction?.count ?? 1) - 1;
              return { opt, votes };
            });

            const totalVotes = results.reduce((sum, r) => sum + r.votes, 0);
            const winner = results.reduce((a, b) => (a.votes >= b.votes ? a : b));

            const resultsEmbed = new EmbedBuilder()
              .setTitle(`📊 Poll Ended: ${question}`)
              .setDescription(
                results
                  .map((r, i) => {
                    const pct = totalVotes > 0 ? Math.round((r.votes / totalVotes) * 100) : 0;
                    const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
                    return `${POLL_EMOJIS[i]} **${r.opt}**\n${bar} ${pct}% (${r.votes} vote${r.votes !== 1 ? "s" : ""})`;
                  })
                  .join("\n\n"),
              )
              .setColor(0x57f287)
              .setFooter({
                text:
                  totalVotes === 0
                    ? "No votes were cast."
                    : `🏆 Winner: ${winner.opt} · ${totalVotes} total vote${totalVotes !== 1 ? "s" : ""}`,
              })
              .setTimestamp();

            await fetchedMsg.edit({ embeds: [resultsEmbed] });
            await fetchedMsg.reactions.removeAll().catch(() => {});
          } catch (err) {
            logger.error({ err }, "Error closing poll");
          }
        }, duration * 60 * 1000);
      }
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    const isDM = !message.guild;
    const botMentioned = client.user && message.mentions.has(client.user);
    const isAutoChannel =
      message.guildId !== null &&
      getChannel(message.guildId) === message.channelId;

    if (!botMentioned && !isDM && !isAutoChannel) return;

    let userContent = message.content;
    if (client.user) {
      userContent = userContent
        .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
        .trim();
    }

    if (!userContent) {
      await message.reply("Hey! How can I help you? Just ask me anything.");
      return;
    }

    try {
      const channel = message.channel;
      if ("sendTyping" in channel) {
        await (channel as TextChannel).sendTyping();
      }
    } catch {}

    try {
      const reply = await generateReply(
        openai,
        message.channelId,
        userContent,
        message.guildId,
      );
      await sendLongReply(message, reply, message.guildId);
    } catch (err) {
      logger.error({ err }, "Error generating AI response");
      await message.reply(
        "Sorry, I ran into an error generating a response. Please try again.",
      );
    }
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });

  return client;
}
