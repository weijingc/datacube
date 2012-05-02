rdf_type = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
CHSI = 'http://logd.tw.rpi.edu/source/data-gov/dataset/2159/vocab/enhancement/1/';
DATACUBE = 'http://logd.tw.rpi.edu/source/data-gov/datacube/';
RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
RO = 'http://www.obofoundry.org/ro/ro.owl#';
rdfs_label = RDFS+'label';

var attrModifiedWorks = false;
var listener = function(){ attrModifiedWorks = true; };
document.documentElement.addEventListener("DOMAttrModified", listener, false);
document.documentElement.setAttribute("___TEST___", true);
document.documentElement.removeAttribute("___TEST___", true);
document.documentElement.removeEventListener("DOMAttrModified", listener, false);

if (!attrModifiedWorks) {
    HTMLElement.prototype.__setAttribute = HTMLElement.prototype.setAttribute
    HTMLElement.prototype.setAttribute = function(attrName, newVal) {
        var prevVal = this.getAttribute(attrName);
        this.__setAttribute(attrName, newVal);
        newVal = this.getAttribute(attrName);
        if (newVal != prevVal) {
            var evt = document.createEvent("MutationEvent");
            evt.initMutationEvent(
                "DOMAttrModified",
                true,
                false,
                this,
                prevVal || "",
                newVal || "",
                attrName,
                (prevVal == null) ? evt.ADDITION : evt.MODIFICATION
            );
            this.dispatchEvent(evt);
        }
    }
}

var shortcuts = {
    "label":RDFS+"label",
    "type":RDF+"type",
    "partOf":RO+"part_of",
    "hasPart":RO+"has_part"
};

var endpoint = "http://logd.tw.rpi.edu/sparql.php"
var graph = {}
graph.getResource = function(uri) {
    var result = graph[uri];
    if (result == null) {
        result = {uri: uri};
        graph[uri] = result;
    }
    return result;
};
graph.byClass = function(c) {
    return d3.keys(graph).filter(function(k) {
        if (k == "getResource"|| k=="byClass") return false;
        var d = graph[k];
        if (d[rdf_type] == null) return false;
        return d[rdf_type].some(function(element) {
            return element.uri == c;
        });
    }).map(function(k) {
        return graph[k];
    });
};
graph.add = function(data) {
    var result = {}
    d3.keys(data).forEach(function(uri) {
        var subject = graph.getResource(uri);
        result[uri] = subject;
        d3.keys(data[uri]).forEach(function(predicate) {
            subject[predicate] = data[uri][predicate].map(function(obj) {
                if (obj.type == "literal") {
                    return obj.value;
                } else {
                    return graph.getResource(obj.value);
                }
            })
        })
        d3.keys(shortcuts).forEach(function(shortcut) {
            subject[shortcut] = subject[shortcuts[shortcut]];
        });
    });
    return result;
};

String.prototype.format = function() {
    var formatted = this;
    for (var i = 0; i < arguments.length; i++) {
        var regexp = new RegExp('\\{'+i+'\\}', 'gi');
        formatted = formatted.replace(regexp, arguments[i]);
    }
    return formatted;
};

function sadi(kb, url) {
    var data = $.ajax({
        beforeSend: function(req) {
            req.setRequestHeader("Accept", "application/json");
        },
        type: 'POST',
        url: url,
        processData: false,
        contentType: 'application/rdf+xml',
        async: false,
        data: kb.dump({format:'application/rdf+xml', 
                       serialize: true})
    });
    
    data = $.parseJSON(data.responseText);
    //console.log(data);
    return graph.add(data);
}

function getCategories(datasets, callback) {
    query = "PREFIX datacube: <http://logd.tw.rpi.edu/source/data-gov/datacube/>\
PREFIX dcterms: <http://purl.org/dc/terms/>\
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
construct {\
    ?category a datacube:Category;\
              rdfs:label ?label.\
} where {\
    graph <{0}> {\
        ?category a datacube:Category;\
                  dcterms:identifier ?label.\
    }\
}";
    datasets.forEach(function(dataset) {
        sparqlConstruct(query.format(dataset),endpoint,function(json) {
            graph.add(json);
            var categories = graph.byClass(DATACUBE+'Category');
            callback(categories);
        });
    });
}

function getMeasures(category, callback) {
    query = "PREFIX ro:      <http://www.obofoundry.org/ro/ro.owl#> \
PREFIX dcterms: <http://purl.org/dc/terms/> \
PREFIX datacube: <http://logd.tw.rpi.edu/source/data-gov/datacube/> \
PREFIX qb: <http://purl.org/linked-data/cube#> \
construct { \
  ?measure ro:part_of <{0}>; \
           rdfs:label ?label. \
  <{0}> ro:has_part ?measure. \
} where { \
  ?measure ro:part_of <{0}>; \
           a datacube:Measure; \
           rdfs:label ?label. \
  [ qb:measureType ?measure; \
    a datacube:SingularValue] \
}";
    //console.log(query.format(category.uri));
    sparqlConstruct(query.format(category.uri),endpoint,function(json) {
        graph.add(json);
        callback(category);
    });
}

function getYears(dataset, callback) {
    query = "PREFIX datacube: <http://logd.tw.rpi.edu/source/data-gov/datacube/> \
PREFIX prov: <http://www.w3.org/ns/prov-o/> \
select distinct ?year \
WHERE { \
  GRAPH <{0}> { \
    [ a datacube:SingularValue; prov:startedAt ?year] \
  } \
} ORDER BY ?year"
    sparqlSelect(query.format(dataset),endpoint,function(json) {
        console.log(json);
        years = json.results.bindings.map(function(row) {
            return row.year;
        });
        callback(years);
    });
}

function getData(measures, callback) {
    var sparqlQuery = 'PREFIX datacube: <http://logd.tw.rpi.edu/source/data-gov/datacube/>\
PREFIX qb: <http://purl.org/linked-data/cube#>\
PREFIX prov: <http://www.w3.org/ns/prov-o/>\
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
\
select distinct ?datum ?loc ?value ?year WHERE {\
    ?datum qb:measureType <{0}>;\
           prov:location ?loc;\
           prov:startedAt ?year;\
           rdf:value ?value.\
}';

    measures.forEach(function(measure) {
        sparqlSelect(sparqlQuery.format(measure.uri),endpoint,function(json) {
            json.results.bindings.forEach(function(entry) {
                value = parseFloat(entry.value.value);
                if (value < 0) {
                    return;
                }
                var loc = graph.getResource(entry.loc.value);
                if (loc[measure.uri] == null) {
                    loc[measure.uri] = {};
                }
                loc[measure.uri][entry.year.value] = value;
                if (measure.data == null) {
                    measure.data = [];
                }
                measure.data[loc.uri] = loc;
            });
            callback();
        });
    });
}

function sparqlConstruct(query, endpoint, callback) {
    var encodedQuery = encodeURIComponent(query);
    var url = endpoint+"?query="+encodedQuery+"&output=rdfjson";
    console.log(url);
    d3.json(url, callback);
}

function sparqlSelect(query, endpoint, callback) {
    var encodedQuery = encodeURIComponent(query);
    var url = endpoint+"?query="+encodedQuery+"&output=sparqljson";
    d3.json(url, callback);
}

function load(dataset) {
    getCategories(dataset, makePicker);
    getYears(dataset,makeSlider);
}

function getYear() {
    return $('a#handle_year').attr("aria-valuetext");
}

function makeSlider(years) {
    console.log(years);
    var yearSelect = d3.select("select#year");
    yearSelect.selectAll("option")
        .data(years)
        .enter()
        .append("option")
        .attr("value",function(d) {return d.value;})
        .text(function(d) {return d.value;});
    $('select#year').selectToUISlider({
	labels: years.length/5
    });
    d3.select('a#handle_year').on("DOMAttrModified",function(){
        if (d3.event.attrName == "aria-valuetext") {
            var checked = $("input:checked");
            var measures = $.makeArray(checked.map(function() {
                return this.__data__;
            }));
            makeScatterPlotMatrix(measures, getYear());
        }
    });
}

function getLocations(measures) {
    locs = {};
    measures.forEach(function(measure) {
        d3.keys(measure.data).forEach(function(uri) {
            locs[uri] = measure.data[uri];
        });
    });
    return locs;
}

function updateMeasures(category) {
    category.measures = category.hasPart;
    //console.log(category);
    var panel = d3.select("#"+category.panelID);
    //panel = panel.append("form");
    panel = panel.append("table");
    var header = panel.append("tr");
    header.append("th").text("Scatter");
    header.append("th").text("Map");
    header.append("th").text("Measure");
    var tbody = panel.append("tbody");
    var measures = tbody.selectAll("tr").data(category.measures)
        .enter().append("tr");
    measures.append("td").attr("align","center")
        .append("input").attr("type","checkbox")
        .on("click",function(d) {
            fn = function() {
                var checked = $("input:checked");
                var measures = $.makeArray(checked.map(function() {
                    return this.__data__;
                }));
                makeScatterPlotMatrix(measures, getYear());
            }
            if (d.data == null) {
                getData([d], fn);
            } else {
                fn();
            }
        });
    measures.append("td").attr("align","center")
        .append("input").attr("type","radio")
        .on("click",function(d) {
            fn = function() {
            }
            if (d.data == null) {
                getData([d], fn);
            } else {
                fn();
            }
        })
        .attr("name","heatmap");
    measures.append("td")
        .text(function(d) {
            return d[RDFS+"label"][0];
        });
}

function makePicker(categories) {
    var picker = d3.select("#picker");
    var panels = picker.selectAll("span").data(categories).enter().append("div");
    panels.append("h3")
        .text(function(d) {
            return d.label[0];
        });
    panels.append("div")
        .attr("id",function(d) {
            d.panelID =  d.label[0].replace(/ /g,"_");
            return d.panelID;
        })
        //.text(function(d) {
        //    return d[RDFS+"label"][0];
        //});
    $("#picker")
        .addClass("ui-accordion ui-accordion-icons ui-widget ui-helper-reset")
        .find("div")
        .find("h3")
        .addClass("ui-accordion-header ui-helper-reset ui-state-default ui-corner-top ui-corner-bottom")
        .hover(function() { $(this).toggleClass("ui-state-hover"); })
        .prepend('<span class="ui-icon ui-icon-triangle-1-e"></span>')
        .click(function() {
            //console.log(this.__data__);
            var category = this.__data__;
            if (category.measures == null) {
                category.measures = getMeasures(category, updateMeasures);
            }
            $(this)
                .toggleClass("ui-accordion-header-active ui-state-active ui-state-default ui-corner-bottom")
                .find("> .ui-icon").toggleClass("ui-icon-triangle-1-e ui-icon-triangle-1-s").end()
                .next().toggleClass("ui-accordion-content-active").slideToggle();
            return false;
        })
        .next()
        .addClass("ui-accordion-content  ui-helper-reset ui-widget-content ui-corner-bottom")
        .hide();

}

function makeScatterPlotMatrix(measures, year) {
	// console.log(measures);
    // Size parameters.
    var size = 150,
    padding = 20,
    n = measures.length;
    
    locs = d3.values(getLocations(measures, year));
    // Position scales.
    var x = {}, y = {};
    measures.forEach(function(measure) {
        var value = function(d) { 
            if (d[measure.uri] == null) {
                return null;
            }
            return d[measure.uri][year]; 
        },
        domain = [d3.min(locs, value), d3.max(locs, value)],
        range = [padding / 2, size - padding / 2];
        //console.log(domain);
        //console.log(range);
        x[measure.uri] = d3.scale.linear().domain(domain).range(range);
        y[measure.uri] = d3.scale.linear().domain(domain).range(range.slice().reverse());
    });
    
    
    // Brush.
    var brush = d3.svg.brush()
        .on("brushstart", brushstart)
        .on("brush", brush)
        .on("brushend", brushend);

    d3.select("#chart").selectAll("svg").remove();

    // Root panel.
    var svg = d3.select("#chart").append("svg")
        .attr("width", size * n + padding+20)
        .attr("height", size * n + padding+20);
    
    // X-axis.
    svg.selectAll("g.x.axis")
        .data(measures)
        .enter().append("g")
        .attr("class", "x axis")
        .style("stroke-width",1)
        .attr("transform", function(d, i) {
            return "translate(" + i * size + ","+(i+1)*size+")";
        })
        .each(function(d,i) { 
            if (i < measures.length -1) {
                // Axes.
                var axis = d3.svg.axis()
                    .ticks(5)
                    .tickSize(size * (n-1-i));

                d3.select(this).call(axis.scale(x[d.uri]).orient("bottom")); 
            }
        });
    
    // Y-axis.
    svg.selectAll("g.y.axis")
        .data(measures)
        .enter().append("g")
        .attr("class", "y axis")
        .style("stroke-width",1)
        .attr("transform", function(d, i) { return "translate(0," + i * size + ")"; })
        .each(function(d, i) {
            if (i > 0) {
                // Axes.
                var axis = d3.svg.axis()
                    .ticks(5)
                    .tickSize(size * (i));
                d3.select(this).call(axis.scale(y[d.uri]).orient("right")); 
            }
        });
    
    // Cell and plot.
    var cell = svg.selectAll("g.cell")
        .data(cross(measures, measures))
        .enter().append("g")
        .attr("class", "cell")
        .attr("transform", function(d) { return "translate(" + d.i * size + "," + d.j * size + ")"; })
    cell.filter(function(d) { return d.i < d.j;})
        .each(plot);
    
    // Titles for the diagonal.
    var infoBox = cell.filter(function(d) {
        return d.i == d.j;
    }).append("svg:foreignObject")
        .attr("width", size + padding)
        .attr("height", size - padding/2)
        .attr("x", padding)
        .attr("y", 0);
    
    infoBox.append("xhtml:body").attr('xmlns',"http://www.w3.org/1999/xhtml");
    var infoBoxBody = infoBox.select("body");
    infoBoxBody.append("div");
    var infoBoxDiv = infoBoxBody.select("div");
    infoBoxDiv.attr("class","infobox");
    infoBoxDiv.append("h3")
        .text(function(d) {
            return d.x.label;
        });
    infoBoxDiv.append("p")
        .text(function(d) {
            //console.log(d.x);
            return "("+d.x.partOf[0].label[0]+")";
        });
    infoBoxDiv.on("click", function(d) {
    	console.log(d);
    	var $infodiv = $('div.modal-display');
    	// get the width and height of the viewport
		var $vpx, $vpy;
		
		if (self.innerHeight) {
			// all except IE
			$vpx = self.innerWidth;
			$vpy = self.innerHeight;
		} else if (document.documentElement && document.documentElement.clientHeight) {
			// IE 6 Strict Mode
			$vpx = document.documentElement.clientWidth;
			$vpy = document.documentElement.clientHeight;
		} else if (document.body) {
			// other IE
			$vpx = document.body.clientWidth;
			$vpy = document.body.clientHeight;
		}
//		console.log("$e:"+$e.pageX+","+$e.pageY);
//		console.log("vp:"+$vpx+","+$vpy);
		$infodiv.css({
			top: 'auto',
			right: 'auto',
			bottom: 'auto',
			left: 'auto'
		});

		// a quick and dirty implementation, replace it with transform/translate stuff
		var infox = d.i*size+500;
		var infoy = d.j*size+100;
		if ($infodiv.outerHeight() > $vpy-infoy) {
			$infodiv.css('bottom', ($vpy-infox)+'px');
		} else {
			$infodiv.css('top', infoy+'px');
		}
		
		if ($infodiv.outerWidth() > $vpx-infox) {
			$infodiv.css('right', ($vpx-infox)+'px');
		} else {
			$infodiv.css('left', infox+'px');
		}
		var table = "<a href='javascript:closeModal();'>[X]</a><table><tr><td>ID:</td><td>"+d.x.label[0]+"</td></tr><tr>" +
				"<td>part of:</td><td>"+d.x.partOf[0].label[0]+"</td></tr></table>";
		$infodiv.html(table);
    	$infodiv.show();
    });
    
    function plot(p) {
        var cell = d3.select(this);
        
        // Plot frame.
        cell.append("rect")
            .attr("class", "frame")
            .attr("x", padding / 2)
            .attr("y", padding / 2)
            .attr("width", size - padding)
            .attr("height", size - padding);
        
        var filteredLocs = locs.filter(function(d,i) {
            //if (i > 100) return false;
            return d[p.x.uri] != null && d[p.y.uri] != null &&
                d[p.x.uri][year] != null && d[p.y.uri][year] != null;
        });
        //console.log(filteredLocs.length);
        // Plot dots.
        cell.selectAll("circle")
            .data(filteredLocs)
            .enter().append("circle")
            .attr("class", function(d) { return d.uri; })
            .attr("cx", function(d) {
                return x[p.x.uri](d[p.x.uri][year]).toString(); 
            })
            .attr("cy", function(d) {
                return y[p.y.uri](d[p.y.uri][year]).toString(); 
            })
            .attr("r", 1.5);
        
        // Plot brush.
        cell.call(brush.x(x[p.x]).y(y[p.y]));
    }
    
    // Clear the previously-active brush, if any.
    function brushstart(p) {
        if (brush.data !== p) {
            cell.call(brush.clear());
            brush.x(x[p.x]).y(y[p.y]).data = p;
        }
    }
    
    // Highlight the selected circles.
    function brush(p) {
        var e = brush.extent();
        svg.selectAll("circle").attr("class", function(d) {
            return e[0][0] <= d[p.x] && d[p.x] <= e[1][0]
                && e[0][1] <= d[p.y] && d[p.y] <= e[1][1]
                ? d.uri : null;
        });
    }
    
    // If the brush is empty, select all circles.
    function brushend() {
        if (brush.empty()) svg.selectAll("circle").attr("class", function(d) {
            return d.uri;
        });
    }
    
    function cross(a, b) {
        var c = [], n = a.length, m = b.length, i, j;
        for (i = -1; ++i < n;) for (j = -1; ++j < m;) c.push({x: a[i], i: i, y: b[j], j: j});
        return c;
    }   
}
function makeNodeSVG(entities, vis, nodeWidth, graph) {
    var node = vis.selectAll("g.node")
        .data(entities)
        .enter();
    node = node.append("svg:foreignObject")
        .attr('width',nodeWidth)
        .attr('height','1000');
    
    node.append("xhtml:body").attr('xmlns',"http://www.w3.org/1999/xhtml");
    
    var body = node.selectAll("body");
    var resource = body.append("table")
        .attr("class","resource");
    var titles = resource.append("xhtml:tr")
        .append("xhtml:th")
        .attr("colspan","2")
        .append("xhtml:a")
        .attr("class","title")
        .html(function(d) {
            if (d.label == "Youth Risk Behavior Surveillance System")
                return '<img src="RDFicon.png" width="12" height="12"/>&nbsp;';
            else return d.label; 
        })
        .attr("href",function(d) { return d.uri});
    var types = resource.append("xhtml:tr")
        .append("xhtml:td")
        .attr("colspan","2")
        .attr("class","type")
        .html(function(d) {
            var typeLabels = d.types.map(function(t) {
                return '<a href="'+t.uri+'">'+t.label+'</a>';
            });
            if (typeLabels.length > 0) {
                return "a&nbsp;" + typeLabels.join(", ");
            } else {
                return "";
            }
        })
        .attr("href",function(d) { return d.uri});
    
    var attrs = resource.selectAll("td.attr")
        .data(function(d) {
            var entries = d3.entries(d.attribs);
            return entries;
        }).enter()
        .append("xhtml:tr");
    attrs.append("xhtml:td")
        .attr("class","attrName")
        .text(function(d) {
            predicate = graph.getResource(d.key);
            return predicate.label+":";
        });
    attrs.append("xhtml:td")
        .html(function(d) {
            return d.value.map(function(d) {
                if (d.type == "resource") {
                    label = d.label;
                    ext = d.uri.split('.');
                    ext = ext[ext.length-1];
                    if ($.inArray(ext, ['jpeg','jpg','png','gif',]) != -1) {
                        label = '<img width="100" src="'+d.uri+'" alt="'+label+'"/>'
                    }
                    if (ext == 'ico') {
                        label = '<img src="'+d.uri+'" alt="'+label+'"/>'
                    }
                    if (d.label == " Youth Risk Behavior Surveillance System")
                        label = d.uri;//'<img src="RDFicon.png" width="12" height="12"/>&nbsp;';
                    result = '<a href="'+d.uri+'">'+label+'</a>';

                    typeLabels = d.types.map(function(t) {
                        return '<a href="'+t.uri+'">'+t.label+'</a>';
                    });
                    if (typeLabels.length > 0) {
                        result +=  " (a&nbsp;" + typeLabels.join(", ") +")";
                    }

                    return result;
                } else return d;
            }).join(",<br>");
        });
    return node;
}

function closeModal() {
	$(".modal-display").hide();
}
