const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
process.env.CLASSROOM_LOCAL='1';
const handler=require('./api/classroom.js');
const server=http.createServer(async(req,res)=>{
 res.status=n=>{res.statusCode=n;return res;};res.json=x=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(x));};
 const url=new URL(req.url,'http://localhost');if(url.pathname==='/api/classroom'){
  let body='';for await(const chunk of req){body+=chunk;if(body.length>8192){res.status(413).json({error:'Слишком большой запрос.'});return;}}try{req.body=JSON.parse(body||'{}');}catch{return res.status(400).json({error:'Неверный JSON.'});}return handler(req,res);
 }
 const target=path.resolve(__dirname,'public','.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
 const root=path.resolve(__dirname,'public')+path.sep;if(!target.startsWith(root)){res.writeHead(403);res.end();return;}
 fs.readFile(target,(error,data)=>{if(error){res.writeHead(404);res.end('Not found');return;}const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(data);});
});
server.listen(Number(process.env.PORT)||4175,'0.0.0.0',()=>console.log('Local: http://localhost:'+(Number(process.env.PORT)||4175)));
