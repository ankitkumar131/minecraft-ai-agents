import itemFactory from 'prismarine-item';

// Creative mode is a server-granted capability. Never spoof it from the profile.
export async function supplyCreative(bot, material, needed, signal, log = () => {}) {
  if (bot.game?.gameMode !== 'creative') throw new Error('Creative supplies require server-confirmed creative mode');
  const item = bot.registry?.itemsByName?.[material];
  if (!item) throw new Error(`Unknown creative material: ${material}`);
  const existing = bot.inventory.items().filter(i => i.name === material).reduce((n, i) => n + i.count, 0);
  let missing = Math.max(0, needed - existing);
  if (!missing) return;
  const Item = itemFactory(bot.registry);
  // Never overwrite a player's existing inventory items.
  const slots = [...Array.from({ length: 9 }, (_, i) => 36 + i), ...Array.from({ length: 27 }, (_, i) => 9 + i)]
    .filter(slot => bot.inventory.slots[slot] === null);
  if (slots.length * 64 < missing) throw new Error(`Not enough empty creative inventory slots for ${missing} ${material}`);
  for (const slot of slots) {
    if (!missing) break;
    if (signal?.aborted) throw new Error('Creative supply cancelled');
    const amount = Math.min(64, missing);
    await bot.creative.setInventorySlot(slot, new Item(item.id, amount));
    missing -= amount;
  }
  log(`Equipped ${needed - existing} ${material} in creative inventory`);
}
