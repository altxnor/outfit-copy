import {
  Extension,
  HDirection,
  HPacket,
  HEntity,
  HGender,
  HEntityType,
} from "gnode-api";

const extensionInfo = {
  name: "Outfit Copy",
  description: "Copy everyone's outfit",
  version: "0.1.1",
  author: "altxnor",
};

const ext = new Extension(extensionInfo);
ext.run();

ext.on("click", () => {
  extState = !extState;
  const state = extState ? "on" : "off";
  sendFeedbackMessage(`Extension is now ${state}`);
});

ext.interceptByNameOrHash(HDirection.TOSERVER, "Chat", onUserMessage);
ext.interceptByNameOrHash(HDirection.TOCLIENT, "Users", onUsers);
ext.interceptByNameOrHash(HDirection.TOCLIENT, "UserChange", onUserChange);
// ext.interceptByNameOrHash(HDirection.TOCLIENT, "UserRemove", onUserRemove);
ext.interceptByNameOrHash(HDirection.TOSERVER, "Quit", clearUsersArray);
ext.interceptByNameOrHash(HDirection.TOCLIENT, "RoomReady", clearUsersArray);

let extState = true;
let usersEntities = [];
let shouldStopCycling = true;
const MAX_USERS = 400;
let myIdx = -1;

const outfitCombinePatterns = [
  // keep hair, legs and head
  /\b(?:hr|lg|hd)[^.\s]*\b/g,
  /\b(?:hr|lg|hd)[^.\s]*\.?\b/g,

  // keep hair, head
  /\b(?:hr|hd)[^.\s]*\b/g,
  /\b(?:hr|hd)[^.\s]*\.?\b/g,

  // keep everything on the head
  /\b(?:hr|hd|he|ha|ea|fa)[^.\s]*\b/g,
  /\b(?:hr|hd|he|ha|ea|fa)[^.\s]*\.?\b/g,
];

function clearUsersArray() {
  myIdx = -1;
  // usersEntities = [];
}

function getUserEntityByName(name) {
  return usersEntities.find(
    (user) => user.name.toLowerCase() === name.toLowerCase()
  );
}

function getUserEntityByIndex(index) {
  return usersEntities.find((user) => user.index === index);
}

function onUsers(hMessage) {
  const users = HEntity.parse(hMessage.getPacket());
  if (myIdx === -1) myIdx = users[0]?.index || -1;

  if (!extState) return;
  for (const userEntity of users) {
    if (usersEntities.find((v) => v.id === userEntity.id) != null) continue;
    if (userEntity.entityType !== HEntityType.HABBO) continue;

    if (usersEntities.length >= MAX_USERS) usersEntities.shift();
    usersEntities.push({
      id: userEntity.id,
      name: userEntity.name,
      index: userEntity.index,
      gender: userEntity.gender,
      figureData: userEntity.figureId,
    });
  }
}

function onUserChange(hMessage) {
  const userChange = hMessage.getPacket().read("iSS");

  if (!extState) return;
  const userIndex = parseInt(userChange[0]);
  const userFigureData = userChange[1].toString();
  const userGender = userChange[2].toString();

  let userEntity = getUserEntityByIndex(userIndex);
  if (!userEntity) return;

  userEntity.figureData = userFigureData;
  userEntity.gender = userGender === "m" ? HGender.Male : HGender.Female;
}

function onUserRemove(hMessage) {
  const userIndex = parseInt(hMessage.getPacket().readString());
  if (!extState) return;
  const userArrIndex = usersEntities.findIndex((u) => u.index === userIndex);
  if (userArrIndex < 0) return;
  usersEntities.splice(userArrIndex, 1);
}

function onUserMessage(hMessage) {
  const message = hMessage.getPacket().readString();
  if (!extState) return;

  const messageCommand = message.split(" ")[0];

  if (!messageCommand.startsWith(":")) return;

  switch (messageCommand) {
    case ":copy":
      hMessage.blocked = true;
      const userName = message.replace(":copy", "").trim();
      const userEntity = getUserEntityByName(userName);
      if (!userEntity) {
        if (usersEntities.length === 0)
          sendFeedbackMessage(`Please, reenter the room`);
        else sendFeedbackMessage(`${userName} not found.`, false);
        return;
      }
      updateFigureData(userEntity);

      break;
    case ":outfitcombine":
      hMessage.blocked = true;
      const params = message.replace(":outfitcombine", "").trim().split(" ");
      if (params.length < 2) return;
      if (usersEntities.length === 0) {
        sendFeedbackMessage(`Please, reenter the room`);
        return;
      }

      let outfitCombineType = params.pop();
      if (isNaN(outfitCombineType)) {
        params.push(outfitCombineType);
        outfitCombineType = 3;
      }

      const users = [];
      params
        .map((name) => getUserEntityByName(name))
        .forEach((u) => {
          if (u != null) users.push(u);
        });

      if (users.length >= 2) {
        combineOutfit(users, outfitCombineType);
      }

      break;
    case ":outfitcycle":
      hMessage.blocked = true;
      if (usersEntities.length === 0) {
        sendFeedbackMessage(`Please, reenter the room`);
        return;
      }
      if (usersEntities.length < 2) return;
      shouldStopCycling = false;
      cycleOutfit(1, 5000);

      break;
    case ":outfitstop":
      hMessage.blocked = true;
      shouldStopCycling = true;

      break;
  }
}

function combineOutfit(users, type = 1) {
  let index = (type - 1) * 2;
  const pattern1 = outfitCombinePatterns[index];
  const pattern2 = outfitCombinePatterns[index + 1];

  const baseFigure = users[0].figureData.match(pattern1).join(".");
  const topFigure = users[1].figureData.replace(pattern2, "");

  const combinedFigures = `${baseFigure}.${topFigure}`;

  updateFigureData({
    figureData: combinedFigures,
    gender: users[0].gender,
  });
}

function cycleOutfit(i, delay) {
  if (i >= usersEntities.length || shouldStopCycling) return;

  updateFigureData(usersEntities[i]);

  setTimeout(() => cycleOutfit(i + 1, delay), delay);
}

function sendFeedbackMessage(message, shout = true) {
  const type = shout ? "Shout" : "Chat";
  const msgPacket = new HPacket(type, HDirection.TOCLIENT)
    .appendInt(myIdx)
    .appendString(message)
    .appendInt(1)
    .appendInt(33)
    .appendInt(0)
    .appendInt(0);

  ext.sendToClient(msgPacket);
}

function updateFigureData(entity) {
  if (entity == null) return;
  const figureData = entity.figureData;
  const gender = entity.gender;

  if (figureData == null || gender == null) {
    return;
  }

  const packet = new HPacket("UpdateFigureData", HDirection.TOSERVER)
    .appendString(gender)
    .appendString(figureData);

  ext.sendToServer(packet);
}
