import java.io.File;
import java.net.URL;
import java.nio.file.Files;
import java.util.*;

import javax.xml.parsers.DocumentBuilderFactory;

import org.dom4j.Element;
import org.nuxeo.common.xmap.Context;
import org.nuxeo.common.xmap.XMap;
import org.nuxeo.ecm.core.io.ExportedDocument;
import org.nuxeo.ecm.core.io.impl.plugins.NuxeoArchiveReader;
import org.nuxeo.ecm.core.lifecycle.LifeCycleState;
import org.nuxeo.ecm.core.lifecycle.extensions.LifeCycleDescriptor;
import org.nuxeo.ecm.core.lifecycle.impl.LifeCycleImpl;
import org.nuxeo.ecm.core.schema.SchemaManagerImpl;
import org.nuxeo.ecm.core.schema.XSDLoader;
import org.nuxeo.ecm.core.schema.types.Field;
import org.nuxeo.ecm.core.schema.types.Schema;

/**
 * Reads the Payers kit's route model zip and components with a Nuxeo server's own classes, outside
 * the server, which nothing here deploys to or changes:
 *
 * <ul>
 *   <li>NuxeoArchiveReader reads the zip as RouteModelsZipImporter does, the platform's
 *       SerialDocumentReview.zip first, as a control;
 *   <li>XMap loads each extension of the kit's model and workflow components with the descriptor
 *       class its extension point declares, and the template-resource resolves to the zip;
 *   <li>XSDLoader loads the workflow's variable schemas, as the type service does;
 *   <li>LifeCycleImpl answers the payersClaim lifecycle's transitions from each state;
 *   <li>MVEL, the server's own version, evaluates each route node's transition conditions, in
 *       order, for the cases below, and its task assignees;
 *   <li>since 0.7.0, the same for the appeal review's model, PayersAppealReview.zip, and MVEL runs
 *       the expressions its chains compute with: where the checklist's decision letter entry is,
 *       which chain writes it, the path a tick writes, the entry an addition writes, and the
 *       comments; and the platform's DateType and BooleanType decode what the chains write as text.
 * </ul>
 *
 * Run by platform-check.mjs, which copies the jars out of the container first:
 * {@code java -cp <jars> PlatformCheck.java <kit> <SerialDocumentReview.zip>}. Java 21. Exit 0 when
 * every check passes, 1 otherwise.
 *
 * <p>What it does not show: that the server imports the model, starts it, or runs its chains. The
 * documents a condition reads are stand-ins for DocumentWrapper, maps of the same keys.
 */
public class PlatformCheck {
  static int failures = 0;

  static void check(boolean ok, String what) {
    System.out.println((ok ? "  ok    " : "  FAIL  ") + what);
    if (!ok) failures++;
  }

  public static void main(String[] args) throws Exception {
    File home = Files.createTempDirectory("nuxeo-env").toFile();
    org.nuxeo.common.Environment.setDefault(new org.nuxeo.common.Environment(home));
    File kit = new File(args[0]);
    File bundle = new File(kit, "bundle");
    File platformZip = new File(args[1]);

    System.out.println("== NuxeoArchiveReader on the platform's SerialDocumentReview.zip (control)");
    List<ExportedDocument> platform = read(platformZip);
    check(platform.size() == 6 && "DocumentRoute".equals(platform.get(0).getType()),
        "platform zip: 6 documents, the first a DocumentRoute");

    System.out.println("== NuxeoArchiveReader on bundle/data/PayersClaimReview.zip");
    List<ExportedDocument> mine = read(new File(bundle, "data/PayersClaimReview.zip"));
    check(mine.size() == 5, "5 documents: the model and its 4 nodes");
    ExportedDocument root = mine.get(0);
    check("DocumentRoute".equals(root.getType()), "the first is a DocumentRoute, as RouteModelsZipImporter requires");
    check("PayersClaimReview".equals(root.getPath().lastSegment()),
        "the model is named PayersClaimReview, by its folder");
    Set<String> nodes = new TreeSet<>();
    for (ExportedDocument d : mine.subList(1, mine.size())) {
      check("RouteNode".equals(d.getType()), d.getPath() + " is a RouteNode");
      check(d.getPath().segmentCount() == 2 && d.getPath().segment(0).equals("PayersClaimReview"),
          d.getPath() + " is a child of the model");
      Element rnode = schema(d, "route_node");
      String nodeId = rnode == null ? null : rnode.elementText("nodeId");
      check(d.getPath().lastSegment().equals(nodeId), d.getPath() + " has rnode:nodeId " + nodeId);
      nodes.add(nodeId);
    }
    check(nodes.equals(new TreeSet<>(List.of("start", "determine", "supervisorApproval", "end"))),
        "the nodes are " + nodes);
    Element docri = schema(root, "document_route_instance");
    check("facet-var_PayersClaimReview".equals(docri.elementText("variablesFacet")),
        "docri:variablesFacet is facet-var_PayersClaimReview");
    check(facets(root).containsAll(List.of("DocumentRoute", "Orderable", "facet-var_PayersClaimReview")),
        "the model carries the DocumentRoute, Orderable and variables facets: " + facets(root));
    check("validated".equals(system(root, "lifecycle-state")),
        "the model is validated, which getRouteModelDocIdWithId looks for");

    System.out.println("== NuxeoArchiveReader on bundle/data/PayersAppealReview.zip, since 0.7.0");
    List<ExportedDocument> appeal = read(new File(bundle, "data/PayersAppealReview.zip"));
    check(appeal.size() == 4, "4 documents: the model and its 3 nodes");
    ExportedDocument appealRoot = appeal.get(0);
    check("DocumentRoute".equals(appealRoot.getType()) && "PayersAppealReview".equals(appealRoot.getPath().lastSegment()),
        "the first is a DocumentRoute, named PayersAppealReview by its folder");
    Set<String> appealNodes = new TreeSet<>();
    for (ExportedDocument d : appeal.subList(1, appeal.size())) {
      Element rnode = schema(d, "route_node");
      check("RouteNode".equals(d.getType()) && d.getPath().segmentCount() == 2
          && d.getPath().segment(0).equals("PayersAppealReview") && rnode != null
          && d.getPath().lastSegment().equals(rnode.elementText("nodeId")),
          d.getPath() + " is a RouteNode of the model, its nodeId its folder's");
      if (rnode != null) appealNodes.add(rnode.elementText("nodeId"));
    }
    check(appealNodes.equals(new TreeSet<>(List.of("start", "decide", "end"))), "the nodes are " + appealNodes);
    check("facet-var_PayersAppealReview".equals(schema(appealRoot, "document_route_instance").elementText("variablesFacet"))
        && "filter@PayersAppealReview".equals(schema(appealRoot, "document_route_instance").elementText("availabilityFilter")),
        "docri:variablesFacet is facet-var_PayersAppealReview, its filter filter@PayersAppealReview");
    check("validated".equals(system(appealRoot, "lifecycle-state")), "the model is validated");

    System.out.println("== XMap, with each extension point's descriptor class");
    Map<String, Class<?>> descriptors = new HashMap<>();
    descriptors.put("org.nuxeo.ecm.platform.routing.service#routeModelImporter",
        Class.forName("org.nuxeo.ecm.platform.routing.api.RouteModelResourceType"));
    descriptors.put("org.nuxeo.ecm.core.lifecycle.LifeCycleService#lifecycle", LifeCycleDescriptor.class);
    descriptors.put("org.nuxeo.ecm.core.lifecycle.LifeCycleService#types",
        Class.forName("org.nuxeo.ecm.core.lifecycle.extensions.LifeCycleTypesDescriptor"));
    descriptors.put("org.nuxeo.ecm.core.operation.OperationServiceComponent#chains",
        Class.forName("org.nuxeo.ecm.automation.core.OperationChainContribution"));
    descriptors.put("org.nuxeo.ecm.core.operation.OperationServiceComponent#event-handlers",
        Class.forName("org.nuxeo.ecm.automation.core.events.EventHandler"));
    descriptors.put("org.nuxeo.ecm.core.schema.TypeService#schema",
        Class.forName("org.nuxeo.ecm.core.schema.SchemaBindingDescriptor"));
    descriptors.put("org.nuxeo.ecm.platform.actions.ActionService#filters",
        Class.forName("org.nuxeo.ecm.platform.actions.DefaultActionFilter"));
    descriptors.put("org.nuxeo.ecm.directory.GenericDirectory#directories",
        Class.forName("org.nuxeo.ecm.directory.BaseDirectoryDescriptor"));

    Context context = new Context() {
      @Override
      public URL getResource(String name) {
        File file = new File(bundle, name);
        try {
          return file.exists() ? file.toURI().toURL() : null;
        } catch (Exception e) {
          return null;
        }
      }
    };
    LifeCycleDescriptor payersClaim = null;
    Set<String> chains = new TreeSet<>();
    Map<String, Object> chainDescriptors = new TreeMap<>();
    Set<String> templateResources = new TreeSet<>();
    List<Object> handlers = new ArrayList<>();
    Map<String, String> lifeCycleOfType = new HashMap<>();
    Set<String> filterIds = new TreeSet<>();
    for (String component : List.of("payers-claims-demo-model.xml", "payers-claims-demo-workflow.xml")) {
      org.w3c.dom.Document xml = DocumentBuilderFactory.newInstance().newDocumentBuilder()
          .parse(new File(bundle, "OSGI-INF/" + component));
      org.w3c.dom.NodeList extensions = xml.getDocumentElement().getElementsByTagName("extension");
      for (int i = 0; i < extensions.getLength(); i++) {
        org.w3c.dom.Element extension = (org.w3c.dom.Element) extensions.item(i);
        String key = extension.getAttribute("target") + "#" + extension.getAttribute("point");
        Class<?> type = descriptors.get(key);
        if (type == null) {
          // Facets and document types, and page providers, are not loaded here: the route model's
          // facets are held to the documents by route-model.selftest.mjs.
          if (key.endsWith("#doctype") || key.endsWith("#providers")) continue;
          check(false, component + ": no descriptor class known for " + key);
          continue;
        }
        XMap xmap = new XMap();
        xmap.register(type);
        Object[] loaded = xmap.loadAll(context, extension);
        check(loaded.length > 0, component + " " + key + ": " + loaded.length + " " + type.getSimpleName());
        for (Object o : loaded) {
          if (o instanceof LifeCycleDescriptor d && "payersClaim".equals(d.getName())) payersClaim = d;
          if (type.getSimpleName().equals("RouteModelResourceType")) {
            URL url = (URL) type.getMethod("getURL").invoke(o);
            String id = (String) type.getMethod("getId").invoke(o);
            templateResources.add(id);
            check(url != null && new File(url.toURI()).isFile()
                && url.getPath().endsWith("/data/" + id + ".zip"),
                "template-resource " + id + " resolves to its zip, " + url);
          }
          if (type.getSimpleName().equals("OperationChainContribution")) {
            String id = (String) type.getMethod("getId").invoke(o);
            List<?> ops = items(type.getMethod("getOps").invoke(o));
            chains.add(id);
            chainDescriptors.put(id, o);
            check(!ops.isEmpty(), "chain " + id + ": " + ops.size() + " operations");
          }
          if (type.getSimpleName().equals("EventHandler")) handlers.add(o);
          if (type.getSimpleName().equals("LifeCycleTypesDescriptor"))
            lifeCycleOfType.put((String) type.getMethod("getDocumentType").invoke(o),
                (String) type.getMethod("getLifeCycleName").invoke(o));
          if (type.getSimpleName().equals("DefaultActionFilter"))
            filterIds.add((String) type.getMethod("getId").invoke(o));
          if (type.getSimpleName().equals("BaseDirectoryDescriptor")) {
            String name = (String) type.getField("name").get(o);
            String dataFile = (String) type.getField("dataFileName").get(o);
            check(List.of("PayersClaimDecision", "PayersAppealDecision").contains(name) && dataFile != null
                && dataFile.equals("data/vocabularies/" + name + ".csv") && new File(bundle, dataFile).isFile(),
                "directory " + name + " reads its entries from " + dataFile + ", a file of the bundle");
          }
          if (type.getSimpleName().equals("SchemaBindingDescriptor")) {
            Object src = type.getField("src").get(o);
            String name = (String) type.getField("name").get(o);
            File file = new File(bundle, String.valueOf(src));
            check(file.isFile(), "schema " + name + " from " + src);
            // The kit's earlier schemas use the document resolver, which needs a running server.
            if (!name.startsWith("var_")) continue;
            Schema schema = new XSDLoader(new SchemaManagerImpl()).loadSchema(name, name, file);
            List<String> fields = new ArrayList<>();
            for (Field f : schema.getFields()) fields.add(f.getName().getLocalName() + ":" + f.getType().getName());
            check(!fields.isEmpty(), "XSDLoader loads " + name + ": " + fields);
          }
        }
      }
    }

    System.out.println("== What the descriptors say");
    check("payersClaim".equals(lifeCycleOfType.get("Claim")), "a Claim follows payersClaim: " + lifeCycleOfType);
    check(filterIds.containsAll(List.of("filter@PayersClaimReview", "filter@PayersAppealReview")),
        "the two availability filters are contributed: " + filterIds);
    check(templateResources.equals(new TreeSet<>(List.of("PayersClaimReview", "PayersAppealReview"))),
        "the two route models are contributed: " + templateResources);
    Class<?> eventHandler = Class.forName("org.nuxeo.ecm.automation.core.events.EventHandler");
    boolean keepsStatus = false;
    for (Object handler : handlers) {
      String chainId = (String) eventHandler.getMethod("getChainId").invoke(handler);
      Set<?> events = (Set<?>) eventHandler.getMethod("getEvents").invoke(handler);
      Set<?> doctypes = (Set<?>) eventHandler.getMethod("getDoctypes").invoke(handler);
      keepsStatus |= "PayersClaim.KeepStatus".equals(chainId) && chains.contains(chainId)
          && events.contains("lifecycle_transition_event") && doctypes != null && doctypes.contains("Claim");
    }
    check(keepsStatus, "a contributed chain, PayersClaim.KeepStatus, handles lifecycle_transition_event on a Claim");

    System.out.println("== The payersClaim lifecycle, as LifeCycleImpl answers it");
    check(payersClaim != null, "payersClaim is contributed");
    if (payersClaim != null) {
      List<String> initial = new ArrayList<>();
      for (LifeCycleState s : payersClaim.getStates()) if (s.isInitial()) initial.add(s.getName());
      LifeCycleImpl lifeCycle = new LifeCycleImpl(payersClaim.getName(), payersClaim.getDefaultInitialStateName(),
          initial, payersClaim.getStates(), payersClaim.getTransitions());
      check("submitted".equals(lifeCycle.getDefaultInitialStateName()), "a claim starts submitted");
      for (LifeCycleState s : lifeCycle.getStates()) {
        List<String> out = new ArrayList<>();
        for (String t : lifeCycle.getAllowedStateTransitionsFrom(s.getName()))
          out.add(t + "->" + lifeCycle.getTransitionByName(t).getDestinationStateName());
        System.out.println("        " + s.getName() + ": " + out);
      }
      check(lifeCycle.getAllowedStateTransitionsFrom("submitted").contains("review"), "submitted -> review");
      check(lifeCycle.getAllowedStateTransitionsFrom("inReview").containsAll(List.of("approve", "deny")),
          "inReview -> approve, deny");
      check(lifeCycle.getAllowedStateTransitionsFrom("pended").containsAll(List.of("approve", "deny")),
          "pended -> approve, deny");
      check(lifeCycle.getAllowedStateTransitionsFrom("project").contains("submit"), "project -> submit");
      check(lifeCycle.getAllowedStateTransitionsFrom("denied").contains("reopen")
          && "inReview".equals(lifeCycle.getTransitionByName("reopen").getDestinationStateName()),
          "denied -> reopen -> inReview, which an overturned appeal's claims review follows");
    }

    System.out.println("== Every chain the nodes name is contributed");
    List<ExportedDocument> allNodes = new ArrayList<>(mine.subList(1, mine.size()));
    allNodes.addAll(appeal.subList(1, appeal.size()));
    for (ExportedDocument d : allNodes) {
      Element rnode = schema(d, "route_node");
      for (Element t : rnode.element("transitions").elements("transition")) {
        String chain = t.elementText("chain");
        if (chain != null && !chain.isBlank())
          check(chains.contains(chain), d.getPath() + "." + t.elementText("name") + " runs " + chain);
      }
    }

    System.out.println("== The nodes' conditions and assignees, with the server's MVEL (mvel2 2.5.2)");
    Map<String, ExportedDocument> byNode = new HashMap<>();
    for (ExportedDocument d : mine.subList(1, mine.size())) byNode.put(d.getPath().lastSegment(), d);
    // Each case: the node, its NodeVariables, the claim's properties, and the transition expected.
    Object[][] cases = {
      {"start", vars(), claim(null, "submitted"), "review"},
      {"start", vars(), claim(null, "inReview"), "notSubmitted"},
      {"start", vars(), claim(null, "approved"), "notSubmitted"},
      // Since 0.7.0: a denied claim, which an overturned appeal starts the review on, is reopened.
      {"start", vars(), claim(null, "denied"), "reopen"},
      {"start", vars(), claim(null, "paid"), "notSubmitted"},
      {"determine", vars("decision", "deny"), claim(2310.0, "inReview"), "denialWithoutReason"},
      {"determine", vars("decision", "deny", "denialReason", "   "), claim(2310.0, "inReview"), "denialWithoutReason"},
      {"determine", vars("decision", "deny", "denialReason", "Not covered"), claim(2310.0, "inReview"), "deny"},
      {"determine", vars("decision", "approve", "allowedAmount", 7000.0), claim(7250.0, "inReview"), "toSupervisor"},
      {"determine", vars("decision", "approve", "allowedAmount", 100.0), claim(5000.01, "inReview"), "toSupervisor"},
      {"determine", vars("decision", "approve", "allowedAmount", 5000.0), claim(5000.0, "inReview"), "approve"},
      {"determine", vars("decision", "approve", "allowedAmount", 0.0), claim(4980.0, "pended"), "approve"},
      {"determine", vars("decision", "approve"), claim(4980.0, "inReview"), "approvalWithoutAmount"},
      {"determine", vars("decision", "approve", "allowedAmount", 5000.5), claim(5000.0, "inReview"), "approvalWithoutAmount"},
      {"determine", vars("decision", "approve", "allowedAmount", -1.0), claim(4980.0, "inReview"), "approvalWithoutAmount"},
      {"determine", vars("decision", "approve", "allowedAmount", 10.0), claim(null, "inReview"), "approvalWithoutAmount"},
      {"determine", vars(), claim(4980.0, "inReview"), "undecided"},
      {"determine", vars("decision", "maybe"), claim(4980.0, "inReview"), "undecided"},
      {"supervisorApproval", vars("button", "approve"), claim(7250.0, "inReview"), "approve"},
      {"supervisorApproval", vars("button", "reject"), claim(7250.0, "inReview"), "sendBack"},
      {"supervisorApproval", vars("button", "other"), claim(7250.0, "inReview"), "unknownAction"},
    };
    followed(byNode, cases);
    Element determine = schema(byNode.get("determine"), "route_node");
    String assignees = determine.elementText("taskAssigneesExpr");
    check("user:alex.rivera".equals(org.mvel2.MVEL.eval(assignees, Map.of("Document", Map.of("claim:adjuster", "alex.rivera")))),
        "determine's task goes to the claim's adjuster");
    Map<String, Object> unassigned = new HashMap<>();
    unassigned.put("claim:adjuster", null);
    check("group:claims-adjusters".equals(org.mvel2.MVEL.eval(assignees, Map.of("Document", unassigned))),
        "and to any adjuster when the claim has none");
    check("group:claims-adjusters".equals(org.mvel2.MVEL.eval(assignees, Map.of("Document", Map.of("claim:adjuster", "")))),
        "or an empty one");
    check("group:claims-supervisors".equals(org.mvel2.MVEL.eval(
            schema(byNode.get("supervisorApproval"), "route_node").elementText("taskAssigneesExpr"), new HashMap<>())),
        "supervisorApproval's task goes to claims-supervisors");

    appealReview(appeal, chainDescriptors);
    operationButtons(bundle, context);
    letterButtons(bundle, context);

    System.out.println(failures == 0 ? "\nAll checks passed." : "\n" + failures + " check(s) failed.");
    System.exit(failures == 0 ? 0 : 1);
  }

  /**
   * Each case, `{node, NodeVariables, Document, the transition expected}`, evaluated as
   * GraphNodeImpl.evaluateTransitions does: the node's conditions in order, with the server's MVEL,
   * the first that holds followed when the node says so.
   */
  static void followed(Map<String, ExportedDocument> byNode, Object[][] cases) {
    for (Object[] c : cases) {
      String node = (String) c[0];
      Element rnode = schema(byNode.get(node), "route_node");
      boolean firstOnly = "true".equals(rnode.elementText("executeOnlyFirstTransition"));
      Map<String, Object> bindings = new HashMap<>();
      bindings.put("NodeVariables", c[1]);
      bindings.put("Document", c[2]);
      List<String> taken = new ArrayList<>();
      for (Element t : rnode.element("transitions").elements("transition")) {
        Object result = org.mvel2.MVEL.eval(t.elementText("condition"), new HashMap<>(bindings));
        if (!(result instanceof Boolean)) {
          check(false, node + "." + t.elementText("name") + " evaluates to a Boolean, as GraphNodeImpl requires");
          continue;
        }
        if ((Boolean) result) {
          taken.add(t.elementText("name"));
          if (firstOnly) break;
        }
      }
      check(taken.equals(List.of(c[3])), node + " with " + c[1] + " on " + c[2] + " follows " + taken);
    }
  }

  /**
   * Since 0.7.0, the appeal review: its nodes' conditions and its task's assignees, as for the claims
   * review, then what its chains compute with the server's MVEL, as Automation's Scripting runs an
   * {@code expr:} value, `Document` a stand-in for DocumentWrapper, a map of the same keys, and
   * `CurrentDate` the platform's own DateWrapper. What it does not show: that the server runs the
   * chains, writes the checklist or starts the claims review, which only an install does.
   */
  static void appealReview(List<ExportedDocument> appeal, Map<String, Object> chains) throws Exception {
    System.out.println("== The appeal review's conditions and assignees, with the server's MVEL");
    Map<String, ExportedDocument> byNode = new HashMap<>();
    for (ExportedDocument d : appeal.subList(1, appeal.size())) byNode.put(d.getPath().lastSegment(), d);
    Object[][] cases = {
      {"start", vars(), kase("appeal", "open", "c1"), "review"},
      {"start", vars(), kase("appeal", "inReview", "c1"), "underWay"},
      {"start", vars(), kase("appeal", "decided", "c1"), "notAnAppealToDecide"},
      {"start", vars(), kase("appeal", "closed", "c1"), "notAnAppealToDecide"},
      {"start", vars(), kase("grievance", "open", "c1"), "notAnAppealToDecide"},
      {"start", vars(), kase("appeal", "open", null), "notAnAppealToDecide"},
      {"start", vars(), kase("appeal", "open", ""), "notAnAppealToDecide"},
      {"decide", vars("decision", "uphold", "rationale", "Not covered"), kase("appeal", "decided", "c1"), "alreadyDecided"},
      {"decide", vars("decision", "overturn", "rationale", "Covered"), kase("appeal", "closed", "c1"), "alreadyDecided"},
      {"decide", vars("decision", "uphold"), kase("appeal", "inReview", "c1"), "decisionWithoutRationale"},
      {"decide", vars("decision", "overturn", "rationale", "  "), kase("appeal", "inReview", "c1"), "decisionWithoutRationale"},
      {"decide", vars("decision", "uphold", "rationale", "Not covered"), kase("appeal", "inReview", "c1"), "uphold"},
      {"decide", vars("decision", "overturn", "rationale", "Covered"), kase("appeal", "inReview", "c1"), "overturn"},
      {"decide", vars(), kase("appeal", "inReview", "c1"), "undecided"},
      {"decide", vars("decision", "reverse", "rationale", "x"), kase("appeal", "inReview", "c1"), "undecided"},
    };
    followed(byNode, cases);
    String assignees = schema(byNode.get("decide"), "route_node").elementText("taskAssigneesExpr");
    check("user:sam.patel".equals(org.mvel2.MVEL.eval(assignees, Map.of("Document", Map.of("case:assignee", "sam.patel")))),
        "decide's task goes to the appeal's specialist");
    Map<String, Object> nobody = new HashMap<>();
    nobody.put("case:assignee", null);
    check("group:member-services".equals(org.mvel2.MVEL.eval(assignees, Map.of("Document", nobody)))
        && "group:member-services".equals(org.mvel2.MVEL.eval(assignees, Map.of("Document", Map.of("case:assignee", "")))),
        "and to member services when it has none, or an empty one");

    System.out.println("== The appeal review's chains, as their expressions compute");
    for (String id : List.of("PayersAppealReview.Uphold", "PayersAppealReview.Overturn")) {
      // Overturn keeps the appeal's number first, in a variable of its own.
      String find = param(chains, id, "Context.SetVar", "value", id.endsWith(".Overturn") ? 1 : 0);
      String which = param(chains, id, "RunOperation", "id", 0);
      List<Object> letter = new ArrayList<>();
      letter.add(entry("appealLetter", true));
      letter.add(entry("decisionLetter", false));
      letter.add(entry("decisionLetter", true));
      Object none = eval(find, Map.of("Document", new HashMap<>(Collections.singletonMap("case:checklist", null))));
      Object empty = eval(find, Map.of("Document", Map.of("case:checklist", new ArrayList<>())));
      Object without = eval(find, Map.of("Document", Map.of("case:checklist", List.of(entry("appealLetter", true)))));
      Object first = eval(find, Map.of("Document", Map.of("case:checklist", letter)));
      check(Integer.valueOf(-1).equals(none) && Integer.valueOf(-1).equals(empty) && Integer.valueOf(-1).equals(without)
          && Integer.valueOf(1).equals(first),
          id + " finds the decision letter's first entry: none " + none + ", empty " + empty + ", without " + without + ", with two " + first);
      check("PayersAppealReview.AddDecisionLetter".equals(eval(which, Map.of("decisionLetterAt", -1)))
          && "PayersAppealReview.TickDecisionLetter".equals(eval(which, Map.of("decisionLetterAt", 1))),
          id + " adds an entry when there is none, and ticks the first when there is: " + which);
    }
    DateWrapperProbe today = new DateWrapperProbe();
    String day = today.format("yyyy-MM-dd");
    Map<String, Object> tick = new HashMap<>(Map.of("decisionLetterAt", 2, "nodeLastActor", "sam.patel", "CurrentDate", today.wrapper));
    List<String> paths = new ArrayList<>();
    for (int i = 0; i < 3; i++) paths.add(String.valueOf(eval(param(chains, "PayersAppealReview.TickDecisionLetter", "Document.SetProperty", "xpath", i), tick)));
    check(paths.equals(List.of("case:checklist/2/done", "case:checklist/2/doneBy", "case:checklist/2/doneOn")),
        "TickDecisionLetter writes the entry's three subfields, at its index: " + paths);
    check("sam.patel".equals(eval(param(chains, "PayersAppealReview.TickDecisionLetter", "Document.SetProperty", "value", 1), tick))
        && day.equals(eval(param(chains, "PayersAppealReview.TickDecisionLetter", "Document.SetProperty", "value", 2), tick)),
        "with the specialist, and the server's day, " + day);
    // BooleanType's decode reads a runtime property, which this check has no runtime for: done's
    // value is held to the text it reads as true instead.
    Object decodedDay = org.nuxeo.ecm.core.schema.types.primitives.DateType.INSTANCE.decode(day);
    check(decodedDay instanceof Calendar c && new java.text.SimpleDateFormat("yyyy-MM-dd").format(c.getTime()).equals(day)
        && "true".equals(param(chains, "PayersAppealReview.TickDecisionLetter", "Document.SetProperty", "value", 0)),
        "the platform's DateType decodes the day as SetProperty decodes a text, and done is written true: " + decodedDay);
    String added = run(param(chains, "PayersAppealReview.AddDecisionLetter", "Document.AddItemToListProperty", "complexJsonProperties", 0), tick);
    check(("[{\"item\": \"decisionLetter\", \"done\": true, \"doneBy\": \"sam.patel\", \"doneOn\": \"" + day + "\"}]").equals(added),
        "AddDecisionLetter adds the entry, done, by the specialist, on the server's day: " + added);

    Map<String, Object> decided = new HashMap<>();
    decided.put("nodeLastActor", "sam.patel");
    decided.put("appeal", "CASE-9001");
    decided.put("NodeVariables", new HashMap<>(Map.of("rationale", "The service was covered (fictional).")));
    check("sam.patel upheld the denial: The service was covered (fictional).".equals(
            run(param(chains, "PayersAppealReview.Uphold", "Audit.LogEvent", "comment", 0), decided)),
        "Uphold records who and why in the case's history");
    check("sam.patel overturned the denial: The service was covered (fictional).".equals(
            run(param(chains, "PayersAppealReview.Overturn", "Audit.LogEvent", "comment", 0), decided)),
        "Overturn records who and why in the case's history");
    // Then, on the claim, by its lifecycle state: reopened when it is denied, and left otherwise.
    String claimChoice = param(chains, "PayersAppealReview.Overturn", "RunOperation", "id", 1);
    List<String> chosen = new ArrayList<>();
    for (String state : List.of("denied", "approved", "paid", "submitted", "inReview", "pended"))
      chosen.add(state + "=" + eval(claimChoice, Map.of("Document", Map.of("lifeCycle", state))));
    check(chosen.equals(List.of("denied=PayersAppealReview.ReopenClaim", "approved=PayersAppealReview.LeaveClaim",
            "paid=PayersAppealReview.LeaveClaim", "submitted=PayersAppealReview.LeaveClaim",
            "inReview=PayersAppealReview.LeaveClaim", "pended=PayersAppealReview.LeaveClaim")),
        "Overturn reopens a denied claim only, and leaves any other: " + chosen);
    check("sam.patel overturned the denial on appeal CASE-9001. The claim is reopened for a new determination.".equals(
            run(param(chains, "PayersAppealReview.ReopenClaim", "Audit.LogEvent", "comment", 0), decided))
        && "PayersClaimReview".equals(param(chains, "PayersAppealReview.ReopenClaim", "Context.StartWorkflow", "id", 0)),
        "ReopenClaim names the appeal in the claim's history, and starts the claims review on it");
    check("sam.patel overturned a denial on appeal CASE-9001. The claim is not denied, so it is not reopened.".equals(
            run(param(chains, "PayersAppealReview.LeaveClaim", "Audit.LogEvent", "comment", 0), decided)),
        "LeaveClaim says in the claim's history why it is not reopened");
    check("CASE-9001".equals(eval(param(chains, "PayersAppealReview.Overturn", "Context.SetVar", "value", 0),
            Map.of("Document", Map.of("case:number", "CASE-9001")))),
        "Overturn keeps the appeal's number before it reads the claim");
  }

  /** An {@code expr:} value, as Scripting runs one that is not a template: MVEL, the server's. */
  static Object eval(String expression, Map<String, Object> variables) {
    return org.mvel2.MVEL.eval(expression.substring("expr:".length()), new HashMap<>(variables));
  }

  /** The value of the parameter `name` of the `index`th operation `operation` of the chain `id`. */
  static String param(Map<String, Object> chains, String id, String operation, String name, int index) throws Exception {
    Object chain = chains.get(id);
    if (chain == null) throw new IllegalStateException("no chain " + id);
    int seen = 0;
    for (Object op : items(chain.getClass().getMethod("getOps").invoke(chain))) {
      if (!operation.equals(op.getClass().getMethod("getId").invoke(op))) continue;
      if (seen++ != index) continue;
      for (Object p : items(op.getClass().getMethod("getParams").invoke(op)))
        if (name.equals(p.getClass().getMethod("getName").invoke(p)))
          return ((String) p.getClass().getMethod("getValue").invoke(p)).strip();
    }
    throw new IllegalStateException(id + " has no operation " + operation + " #" + index + " with " + name);
  }

  /** The platform's CurrentDate, Automation's DateWrapper, and its day as it formats one. */
  static final class DateWrapperProbe {
    final Object wrapper;

    DateWrapperProbe() throws Exception {
      wrapper = Class.forName("org.nuxeo.ecm.automation.core.scripting.DateWrapper").getConstructor().newInstance();
    }

    String format(String pattern) throws Exception {
      return (String) wrapper.getClass().getMethod("format", String.class).invoke(wrapper, pattern);
    }
  }

  /** A checklist entry, as the server answers one: its item and whether it is done. */
  static Map<String, Object> entry(String item, boolean done) {
    Map<String, Object> m = new HashMap<>();
    m.put("item", item);
    m.put("done", done);
    m.put("doneBy", null);
    m.put("doneOn", null);
    return m;
  }

  /** The case, as DocumentWrapper answers it: properties by xpath. */
  static Map<String, Object> kase(String category, String state, String claim) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("case:category", category);
    m.put("case:state", state);
    m.put("case:claim", claim);
    return m;
  }

  /**
   * A comment's template, as the server's MVEL runs it, its surrounding white space left out: the
   * XML's line breaks around a value are not what the check is about.
   */
  static String run(String expression, Map<String, Object> variables) {
    return String.valueOf(org.mvel2.templates.TemplateRuntime.eval(expression.substring("expr:".length()), variables)).strip();
  }

  /** A descriptor's list, as an array or a list, whichever the server's version returns. */
  static List<?> items(Object value) {
    return value instanceof Object[] array ? Arrays.asList(array) : (List<?>) value;
  }

  /** {@code CurrentUser} in an Automation expression: what the chains' comments read of it. */
  public static final class User {
    private final String name;

    User(String name) {
      this.name = name;
    }

    public String getName() {
      return name;
    }
  }

  /**
   * The operation buttons' component, payers-claims-demo-operations.xml: its two chains, loaded by the
   * descriptor class their point declares, each beginning with its guard, and no REST binding, which
   * AgenticUi.RunAction would apply to the button too; and each chain's comment, a template, run by the server's MVEL with chain
   * parameters as AgenticUi.RunAction gives them. What it does not show: that the server runs the
   * chains, which only an install does.
   */
  static void operationButtons(File bundle, Context context) throws Exception {
    System.out.println("== The operation buttons' chains");
    Class<?> chainType = Class.forName("org.nuxeo.ecm.automation.core.OperationChainContribution");
    Class<?> bindingType = Class.forName("org.nuxeo.ecm.automation.server.RestBinding");
    org.w3c.dom.Document xml = DocumentBuilderFactory.newInstance().newDocumentBuilder()
        .parse(new File(bundle, "OSGI-INF/payers-claims-demo-operations.xml"));
    org.w3c.dom.NodeList extensions = xml.getDocumentElement().getElementsByTagName("extension");
    Map<String, Object> chains = new TreeMap<>();
    Map<String, Object> bindings = new TreeMap<>();
    for (int i = 0; i < extensions.getLength(); i++) {
      org.w3c.dom.Element extension = (org.w3c.dom.Element) extensions.item(i);
      String key = extension.getAttribute("target") + "#" + extension.getAttribute("point");
      Class<?> type = switch (key) {
        case "org.nuxeo.ecm.core.operation.OperationServiceComponent#chains" -> chainType;
        default -> null;
      };
      check(type != null, "payers-claims-demo-operations.xml contributes to " + key);
      if (type == null) continue;
      XMap xmap = new XMap();
      xmap.register(type);
      for (Object o : xmap.loadAll(context, extension)) {
        if (type == chainType) chains.put((String) type.getMethod("getId").invoke(o), o);
        else bindings.put((String) bindingType.getField("name").get(o), o);
      }
    }
    List<String> ids = List.of("Payers.ReferToInvestigations", "Payers.RequestMedicalRecords");
    check(chains.keySet().equals(new TreeSet<>(ids)), "the two chains are contributed: " + chains.keySet());
    check(bindings.isEmpty(), "no REST binding, which would keep the button from those it is for: " + bindings.keySet());
    for (Map.Entry<String, Object> chain : chains.entrySet()) {
      List<?> ops = items(chainType.getMethod("getOps").invoke(chain.getValue()));
      Object first = ops.isEmpty() ? null : ops.get(0);
      String guarded = null;
      if (first != null && "AgenticUi.RequireRunAction".equals(first.getClass().getMethod("getId").invoke(first))) {
        for (Object param : items(first.getClass().getMethod("getParams").invoke(first))) {
          if ("operation".equals(param.getClass().getMethod("getName").invoke(param)))
            guarded = (String) param.getClass().getMethod("getValue").invoke(param);
        }
      }
      check(chain.getKey().equals(guarded == null ? null : guarded.strip()),
          chain.getKey() + " begins with AgenticUi.RequireRunAction for itself, so only a button runs it: " + (guarded == null ? null : guarded.strip()));
    }
    Map<String, String> comments = new TreeMap<>();
    for (Map.Entry<String, Object> chain : chains.entrySet()) {
      for (Object op : items(chainType.getMethod("getOps").invoke(chain.getValue()))) {
        Class<?> opType = op.getClass();
        if (!"Audit.LogEvent".equals(opType.getMethod("getId").invoke(op))) continue;
        for (Object param : items(opType.getMethod("getParams").invoke(op))) {
          Class<?> paramType = param.getClass();
          if ("comment".equals(paramType.getMethod("getName").invoke(param)))
            comments.put(chain.getKey(), (String) paramType.getMethod("getValue").invoke(param));
        }
      }
    }
    check(comments.keySet().equals(new TreeSet<>(ids)), "each records itself with Audit.LogEvent: " + comments.keySet());
    String request = comments.getOrDefault("Payers.RequestMedicalRecords", "");
    check(request.startsWith("expr:"), "Request medical records' comment is an expression");
    Map<String, Object> urgent = new HashMap<>();
    urgent.put("CurrentUser", new User("dana.lee"));
    urgent.put("ChainParameters", new HashMap<>(Map.of("provider", "p1", "urgent", true, "note", "Before Friday")));
    Object said = run(request, urgent);
    check("dana.lee asked the provider for the claim's medical records, urgently: Before Friday".equals(said),
        "with urgent and a note: " + said);
    Map<String, Object> plain = new HashMap<>();
    plain.put("CurrentUser", new User("dana.lee"));
    // A form's flag left unticked is not sent: the chain parameter is absent, not false.
    plain.put("ChainParameters", new HashMap<>(Map.of("provider", "p1", "note", "x")));
    said = run(request, plain);
    check("dana.lee asked the provider for the claim's medical records: x".equals(said), "with no urgent: " + said);
    // A value is data: an expression in it is written as it is, never run.
    plain.put("ChainParameters", new HashMap<>(Map.of("note", "@{Session.removeDocument(null)}")));
    said = run(request, plain);
    check(String.valueOf(said).endsWith(": @{Session.removeDocument(null)}"), "a note holding a template is text: " + said);
    String refer = comments.getOrDefault("Payers.ReferToInvestigations", "");
    said = run(refer, plain);
    check("dana.lee referred the claim to special investigations.".equals(said), "the referral: " + said);
  }

  /**
   * Since 0.8.0, the letter buttons' component, payers-claims-demo-letters.xml: its two chains, loaded
   * by the descriptor class their point declares, each beginning with its guard and then asking
   * Letter.Generate for its letter, with no REST binding; each chain's language, an expression, run by
   * the server's MVEL with chain parameters as AgenticUi.RunAction gives them, the language left out
   * among them; and its vocabulary, loaded by its descriptor class, with its data file in the bundle.
   * What it does not show: that the server runs the chains, nor what nuxeo-agentic-letters writes,
   * which the add-on's own tests and an install do.
   */
  static void letterButtons(File bundle, Context context) throws Exception {
    System.out.println("== The letter buttons' chains, since 0.8.0");
    Class<?> chainType = Class.forName("org.nuxeo.ecm.automation.core.OperationChainContribution");
    Class<?> directoryType = Class.forName("org.nuxeo.ecm.directory.BaseDirectoryDescriptor");
    org.w3c.dom.Document xml = DocumentBuilderFactory.newInstance().newDocumentBuilder()
        .parse(new File(bundle, "OSGI-INF/payers-claims-demo-letters.xml"));
    org.w3c.dom.NodeList extensions = xml.getDocumentElement().getElementsByTagName("extension");
    Map<String, Object> chains = new TreeMap<>();
    List<Object> directories = new ArrayList<>();
    Set<String> points = new TreeSet<>();
    for (int i = 0; i < extensions.getLength(); i++) {
      org.w3c.dom.Element extension = (org.w3c.dom.Element) extensions.item(i);
      String key = extension.getAttribute("target") + "#" + extension.getAttribute("point");
      points.add(key);
      Class<?> type = switch (key) {
        case "org.nuxeo.ecm.core.operation.OperationServiceComponent#chains" -> chainType;
        case "org.nuxeo.ecm.directory.GenericDirectory#directories" -> directoryType;
        default -> null;
      };
      if (type == null) continue;
      XMap xmap = new XMap();
      xmap.register(type);
      for (Object o : xmap.loadAll(context, extension)) {
        if (type == chainType) chains.put((String) type.getMethod("getId").invoke(o), o);
        else directories.add(o);
      }
    }
    check(points.equals(new TreeSet<>(List.of(
            "org.nuxeo.ecm.core.operation.OperationServiceComponent#chains",
            "org.nuxeo.ecm.core.schema.TypeService#doctype",
            "org.nuxeo.ecm.directory.GenericDirectory#directories",
            "org.nuxeo.ecm.platform.query.api.PageProviderService#providers"))),
        "payers-claims-demo-letters.xml contributes the facet, the vocabulary, the page provider and the chains, and no REST binding: " + points);
    Map<String, String> letters = Map.of("Payers.WriteDenialLetter", "payers.denial",
        "Payers.WriteAppealLetter", "payers.appealOutcome");
    check(chains.keySet().equals(letters.keySet()), "the two letter chains are contributed: " + chains.keySet());
    for (Map.Entry<String, Object> chain : chains.entrySet()) {
      List<?> ops = items(chainType.getMethod("getOps").invoke(chain.getValue()));
      List<String> ids = new ArrayList<>();
      for (Object op : ops) ids.add((String) op.getClass().getMethod("getId").invoke(op));
      check(ids.equals(List.of("AgenticUi.RequireRunAction", "Context.FetchDocument", "Letter.Generate")),
          chain.getKey() + " is its guard, the record fetched, and Letter.Generate: " + ids);
      check(chain.getKey().equals(param(chains, chain.getKey(), "AgenticUi.RequireRunAction", "operation", 0)),
          chain.getKey() + " begins with AgenticUi.RequireRunAction for itself, so only a button runs it");
      check(letters.get(chain.getKey()).equals(param(chains, chain.getKey(), "Letter.Generate", "letter", 0)),
          chain.getKey() + " asks for the letter " + letters.get(chain.getKey()));
      String language = param(chains, chain.getKey(), "Letter.Generate", "language", 0);
      check(language.startsWith("expr:") && !language.contains("@{"),
          chain.getKey() + "'s language is an expression, not a template: " + language);
      Map<String, Object> chosen = new HashMap<>();
      chosen.put("ChainParameters", new HashMap<>(Map.of("language", "es")));
      check("es".equals(eval(language, chosen)), chain.getKey() + " gives the language chosen: " + eval(language, chosen));
      Map<String, Object> none = new HashMap<>();
      // A form's field left empty is not sent: the chain parameter is absent, and so is the language.
      none.put("ChainParameters", new HashMap<>());
      check(eval(language, none) == null, chain.getKey() + " gives no language when none was chosen: " + eval(language, none));
      Map<String, Object> smuggled = new HashMap<>();
      smuggled.put("ChainParameters", new HashMap<>(Map.of("language", "@{Session.removeDocument(null)}")));
      check("@{Session.removeDocument(null)}".equals(eval(language, smuggled)),
          chain.getKey() + " passes a language holding a template on as text: " + eval(language, smuggled));
    }
    check(directories.size() == 1, "one vocabulary: " + directories.size());
    for (Object directory : directories) {
      String name = (String) directoryType.getField("name").get(directory);
      check("PayersLetterLanguage".equals(name), "the vocabulary is PayersLetterLanguage: " + name);
      String data = Files.readString(new File(bundle, "data/vocabularies/PayersLetterLanguage.csv").toPath());
      check(data.contains("\"en\",") && data.contains("\"es\","), "it offers en and es");
    }
  }

  /** NodeVariables, as the route node holds them: every variable of its schema, null when unset. */
  static Map<String, Object> vars(Object... pairs) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("decision", null);
    m.put("allowedAmount", null);
    m.put("denialReason", null);
    m.put("button", null);
    m.put("rationale", null);
    for (int i = 0; i < pairs.length; i += 2) m.put((String) pairs[i], pairs[i + 1]);
    return m;
  }

  /** The claim, as DocumentWrapper answers it: properties by xpath, and its lifeCycle. */
  static Map<String, Object> claim(Double billed, String state) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("claim:billedAmount", billed);
    m.put("lifeCycle", state);
    return m;
  }

  static List<ExportedDocument> read(File zip) throws Exception {
    List<ExportedDocument> documents = new ArrayList<>();
    NuxeoArchiveReader reader = new NuxeoArchiveReader(zip);
    try {
      for (ExportedDocument d = reader.read(); d != null; d = reader.read()) {
        documents.add(d);
        System.out.println("        " + d.getPath() + "  " + d.getType() + "  id=" + d.getId());
      }
    } finally {
      reader.close();
    }
    return documents;
  }

  static Element schema(ExportedDocument d, String name) {
    for (Element e : d.getDocument().getRootElement().elements("schema"))
      if (name.equals(e.attributeValue("name"))) return e;
    return null;
  }

  static String system(ExportedDocument d, String name) {
    return d.getDocument().getRootElement().element("system").elementText(name);
  }

  static List<String> facets(ExportedDocument d) {
    List<String> out = new ArrayList<>();
    for (Element e : d.getDocument().getRootElement().element("system").elements("facet")) out.add(e.getText());
    return out;
  }
}
