import {test, expect} from 'claude-code/testing';
for (const surface of ['desktop','terminal'] as const) {
  test(`small helper preserves other bands and hides technical details on ${surface}`, async ($, on) => {
    on('ui.render',{component:'AbovePrompt'},($,e)=>$.ui.resolve(e).Text({children:['Existing host band']}));
    const ui=await $.ui.mount({plugin:'efficiency-companion',surface,component:'AbovePrompt',props:{} as any});
    expect(await ui.find({type:'Text',text:'Existing host band'})).toBeDefined();
    expect(await ui.find({type:'Text',text:'Hi! I’ll keep this chat light.'})).toBeDefined();
    expect(await ui.find({type:'Text',text:'UTF-8'})).toBeUndefined();
    expect(await ui.find({type:'Text',text:'Nothing shortened yet'})).toBeUndefined();
    await ui.press({key:'details',link:{href:'https://efficiency.invalid/details',text:'Details'}});
    expect(await ui.find({type:'Text',text:'Nothing shortened yet'})).toBeDefined();
    if(surface==='desktop') {
      expect(JSON.stringify(await ui.drawn())).toContain('@keyframes breathe');
      await ui.press({key:'pause-small',link:{href:'https://efficiency.invalid/motion',text:'Pause animation'}});
      expect(JSON.stringify(await ui.drawn())).not.toContain('@keyframes');
    }
    await ui.press({key:'details',link:{href:'https://efficiency.invalid/details',text:'Details'}});
    expect(await ui.find({type:'Text',text:'Nothing shortened yet'})).toBeUndefined();
    await ui.unmount();
  });
}
