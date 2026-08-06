import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';

const app = express();

app.use(cors());
app.use(express.json({ limit: '3mb' }));

const text = (value = '') =>
  value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const escapeHtml = (value = '') =>
  value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));


const wpConfig = () => {

  const { WP_SITE, WP_ACCESS_TOKEN } = process.env;

  console.log("WP SITE:", WP_SITE);
  console.log("TOKEN LENGTH:", WP_ACCESS_TOKEN?.length);

  if (!WP_SITE || !WP_ACCESS_TOKEN) {
    throw new Error('Add WP_SITE and WP_ACCESS_TOKEN to .env');
  }

  return {
    url:
      'https://public-api.wordpress.com/rest/v1.1/sites/' +
      WP_SITE.replace('https://',''),

    auth:
      `Bearer ${WP_ACCESS_TOKEN}`
  };
};


function googleExportUrl(url) {

  const match =
    url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);

  if (!match) {
    throw new Error('Please enter a valid Google Docs link.');
  }

  return `https://docs.google.com/document/d/${match[1]}/export?format=html`;
}


function readLabel(lines,label){

  const row =
    lines.find(line =>
      line.toLowerCase()
      .startsWith(label.toLowerCase())
    );

  return row
    ? row.slice(row.indexOf(':') + 1).trim()
    : '';
}



function htmlFromLines(lines){

  let firstTitle=true;

  return lines
  .filter(Boolean)
  .map(line=>{

    if(/^<[^>]+>/.test(line))
      return line;


    if(firstTitle){
      firstTitle=false;
      return `<h1>${escapeHtml(line)}</h1>`;
    }


    if(/^(20\d{2}\s|Test-Drive)/i.test(line))
      return `<h2>${escapeHtml(line)}</h2>`;


    return `<p>${escapeHtml(line)}</p>`;

  })
  .join('\n');
}



function parseDealerTemplate(sourceHtml){

  const $=cheerio.load(sourceHtml);

  $('script,style,meta,link').remove();


  const lines =
    $('body')
    .find('p,h1,h2,h3,h4,li')
    .map((_,el)=>text($(el).text()))
    .get()
    .filter(Boolean);



  const contentLines =
    lines.filter(line =>
      !/^(keywords|meta title|meta description|page slug|image shortcode|buttons):/i.test(line)
    );


  return {

    title:contentLines[0] || 'Untitled post',

    slug:
      readLabel(lines,'Page Slug')
      .replace(/^\/+|\/+$/g,''),

    metaTitle:
      readLabel(lines,'Meta Title'),

    metaDescription:
      readLabel(lines,'Meta Description'),

    keyword:
      readLabel(lines,'Keywords'),

    imageShortcode:
      readLabel(lines,'Image Shortcode'),

    buttons:
      readLabel(lines,'Buttons'),

    content:
      htmlFromLines(contentLines)

  };

}



// Import Google Doc only
app.post('/api/import',async(req,res)=>{

try{

 const exportUrl =
   googleExportUrl(req.body.url || '');

 const response =
   await fetch(exportUrl);


 if(!response.ok)
   throw new Error('Cannot read Google Doc');


 const data =
   parseDealerTemplate(
     await response.text()
   );


 res.json(data);


}catch(error){

 res.status(400)
 .json({
   error:error.message
 });

}

});




// Create WordPress Draft
app.post('/api/wordpress/draft',async(req,res)=>{


try{


const config=wpConfig();

const post=req.body;


const content=[
 post.imageShortcode,
 post.content,
 post.buttons
]
.filter(Boolean)
.join('\n\n');



const response =
 await fetch(
 `${config.url}/posts/new`,
 {
 method:'POST',

 headers:{
 Authorization:config.auth,
 'Content-Type':'application/json'
 },

 body:JSON.stringify({

 title:post.title,

 content:content,

 status:'draft'

 })

 });


const result =
 await response.json();



if(!response.ok){

 throw new Error(
 result.error ||
 result.message ||
 'WordPress rejected draft'
 );

}



res.json({

 success:true,

 id:result.ID,

 title:result.title,

 url:result.URL

});


}catch(error){

console.error(error);


res.status(400)
.json({
 error:error.message
});


}


});



app.listen(
8787,
()=>console.log(
'Publishing bridge running at http://127.0.0.1:8787'
)
);