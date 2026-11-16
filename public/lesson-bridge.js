(()=>{
const id=window.LEARN_JS_LESSON,embedded=parent!==window;
if(embedded){const style=document.createElement('style');style.textContent='.identity-bubble,.identity-label,#hint{display:none!important}';document.head.append(style);}
const report=()=>{const slides=[...document.querySelectorAll('.slide')],active=document.querySelector('.slide.active'),slide=Math.max(1,slides.indexOf(active)+1);if(embedded)parent.postMessage({type:'learn-js:progress',lesson:id,slide,total:slides.length},location.origin);};
const observer=new MutationObserver(records=>{if(records.some(r=>r.target.classList?.contains('slide')))report();});const stage=document.getElementById('stage');if(stage)observer.observe(stage,{subtree:true,attributes:true,attributeFilter:['class']});
document.addEventListener('lesson:slide',report);window.addEventListener('message',event=>{if(!embedded||event.source!==parent||event.origin!==location.origin||event.data?.type!=='learn-js:action')return;const {action,value}=event.data,L=window.lesson;if(action==='next')L.go(L.current()+1);if(action==='prev')L.go(L.current()-1);if(action==='go'&&Number.isInteger(value))L.go(value);if(action==='notes')document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',bubbles:true}));report();});
if(!embedded){const a=document.createElement('a');a.href='/lesson.html?id='+id+'&slide='+(parseInt(location.hash.slice(1),10)||1);a.textContent='← К курсу learn-js';a.style.cssText='position:fixed;top:18px;left:18px;z-index:50;background:#c5f82a;color:#12160c;padding:10px 15px;border-radius:12px;font:700 14px system-ui;text-decoration:none';document.body.append(a);}
report();setTimeout(report,100);
})();
